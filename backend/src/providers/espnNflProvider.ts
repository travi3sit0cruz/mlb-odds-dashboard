/**
 * Real NFL schedule/score client, backed by ESPN's public, unauthenticated
 * scoreboard JSON endpoint (the same one many open-source sports dashboards
 * use; unlike the basketball `sports.core.api.espn.com` host used for WNBA
 * rosters, this `site.api.espn.com` scoreboard endpoint is reachable from
 * this project's network and returns real teams, real kickoff times, real
 * venues, and real live/final scores).
 *
 * Endpoint: GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
 *   Optional ?dates=YYYYMMDD to fetch a specific day/week's slate; omitted,
 *   it returns the current week.
 *
 * NOTE: Unofficial but widely used public API, no published SLA. All fields
 * are null-checked; a bad shape skips the affected record rather than crash
 * the poller.
 */

import type { GameStatus, NflGameRecord, NflPlayerProjection, NflTeam } from "../types.js";
import { getNflRosters } from "./espnNflRosterCache.js";
import { fetchNflLiveStats, type NflLiveActual } from "./espnNflLiveStats.js";

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";

interface EspnCompetitor {
  homeAway: "home" | "away";
  score?: string;
  team: { id: string; displayName: string; abbreviation: string };
}
interface EspnCompetition {
  venue?: { fullName?: string };
  competitors: EspnCompetitor[];
}
interface EspnEvent {
  id: string;
  date: string;
  week?: { number: number };
  status: { type: { state: "pre" | "in" | "post"; completed: boolean; shortDetail?: string } };
  competitions: EspnCompetition[];
}
interface ScoreboardResponse {
  events: EspnEvent[];
}

function mapStatus(state: string): GameStatus {
  if (state === "pre") return "Preview";
  if (state === "in") return "Live";
  if (state === "post") return "Final";
  return "Unknown";
}

function toTeam(c: EspnCompetitor): NflTeam {
  return { name: c.team.displayName, abbr: c.team.abbreviation };
}

function applyLiveActual(player: NflPlayerProjection, actual: NflLiveActual | undefined): NflPlayerProjection {
  if (!actual) return player;
  const isQb = player.ydsLabel === "Pass Yds";
  const isReceiver = player.ydsLabel === "Rec Yds";
  return {
    ...player,
    actualYds: isQb ? actual.passYds : isReceiver ? actual.recYds : actual.rushYds,
    actualTD: isQb ? actual.passTD : actual.rushTD + actual.recTD,
    actualRecOrAtt: isQb ? actual.completions : isReceiver ? actual.receptions : actual.rushAtt,
  };
}

/** Real in-game (or final) stats for a Live/Final game's skill players, keyed
 *  by athleteId (parsed back out of the roster projection's
 *  `${teamAbbr}-${athleteId}` id). Final games keep fetching so the box score
 *  stays populated after the game ends (NFL's scoreboard scope is a bounded
 *  current-week slate, so this never grows unbounded like MLB's daily volume
 *  would). Returns the roster unchanged (all-zero actuals) if the fetch fails
 *  -- never blocks the schedule/score data on this. */
async function withLiveActuals(
  eventId: string,
  homeTeamEspnId: string,
  awayTeamEspnId: string,
  homeRoster: NflPlayerProjection[],
  awayRoster: NflPlayerProjection[],
): Promise<{ home: NflPlayerProjection[]; away: NflPlayerProjection[] }> {
  function athleteIdOf(p: NflPlayerProjection): string {
    return p.id.slice(p.team.length + 1);
  }
  const players = [
    ...homeRoster.map((p) => ({ teamEspnId: homeTeamEspnId, athleteId: athleteIdOf(p) })),
    ...awayRoster.map((p) => ({ teamEspnId: awayTeamEspnId, athleteId: athleteIdOf(p) })),
  ];
  try {
    const stats = await fetchNflLiveStats(eventId, players);
    return {
      home: homeRoster.map((p) => applyLiveActual(p, stats.get(athleteIdOf(p)))),
      away: awayRoster.map((p) => applyLiveActual(p, stats.get(athleteIdOf(p)))),
    };
  } catch (err) {
    console.warn(`[espn-nfl] live stats fetch failed for event ${eventId}:`, err);
    return { home: homeRoster, away: awayRoster };
  }
}

/** Fetch the real NFL slate. `date`, if given, selects that calendar day
 *  (ESPN scoreboard is otherwise "current week" by default). */
export async function fetchNflGames(date?: Date): Promise<NflGameRecord[]> {
  const url = date
    ? `${SCOREBOARD_URL}?dates=${date.toISOString().slice(0, 10).replace(/-/g, "")}`
    : SCOREBOARD_URL;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN NFL scoreboard: ${res.status}`);
  const data = (await res.json()) as ScoreboardResponse;

  // Real skill-position rosters, keyed by team abbreviation (same ESPN
  // source as the scoreboard above, so abbreviations line up). Served from
  // a 12h stale-while-revalidate cache -- see espnNflRosterCache.ts.
  const rosters = await getNflRosters();

  const now = new Date().toISOString();
  const games: NflGameRecord[] = [];
  for (const event of data.events ?? []) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    const status = mapStatus(event.status?.type?.state);
    // Real play clock + quarter straight from ESPN (e.g. "5:52 - 3rd Quarter").
    const liveClock = status === "Live" ? (event.status?.type?.shortDetail ?? null) : null;
    const homeScore = home.score !== undefined ? Number(home.score) : undefined;
    const awayScore = away.score !== undefined ? Number(away.score) : undefined;
    const homeTeam = toTeam(home);
    const awayTeam = toTeam(away);

    let homeRoster = rosters.get(homeTeam.abbr) ?? [];
    let awayRoster = rosters.get(awayTeam.abbr) ?? [];
    if (status === "Live" || status === "Final") {
      const merged = await withLiveActuals(event.id, home.team.id, away.team.id, homeRoster, awayRoster);
      homeRoster = merged.home;
      awayRoster = merged.away;
    }

    games.push({
      gameId: `nfl-${event.id}`,
      gameDate: event.date,
      status,
      liveClock,
      week: event.week?.number ?? null,
      venue: comp.venue?.fullName ?? null,
      home: homeTeam,
      away: awayTeam,
      homeScore: Number.isFinite(homeScore) ? homeScore : undefined,
      awayScore: Number.isFinite(awayScore) ? awayScore : undefined,
      homeRoster,
      awayRoster,
      lines: [],
      consensus: { homeWinPct: null, awayWinPct: null, prevHomeWinPct: null, prevAwayWinPct: null },
      statsSanityWarning: null,
      fetchedAt: now,
    });
  }

  return games.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
}

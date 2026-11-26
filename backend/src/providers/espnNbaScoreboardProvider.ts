/**
 * Real NBA schedule/score client, backed by ESPN's public, unauthenticated
 * scoreboard JSON endpoint -- the same `site.api.espn.com` host and shape
 * used for NFL (see espnNflProvider.ts). This host had an intermittent
 * Akamai 403 block against basketball paths from this project's network
 * (see espnNbaClient.ts's note), which is why nbaProvider.ts previously
 * fell back to a synthetic daily slate; that block is not consistently
 * reproducing any more, so this real path is tried first on every poll,
 * with the synthetic slate kept as an automatic fallback if it ever
 * fails again (see NbaProvider.getGames() in nbaProvider.ts).
 *
 * Endpoint: GET https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
 *   ?dates=YYYYMMDD selects one calendar day; the NBA plays every day (unlike
 *   NFL's one-slate-per-week cadence), so showing a full calendar week
 *   (Sunday-Saturday) means fetching one day at a time and merging -- see
 *   fetchRealNbaGames() below. Team abbreviations on this endpoint match
 *   ESPN_NBA_TEAMS's `abbr` exactly (verified against a live response), so
 *   rosters -- keyed by that same abbr -- line up with no translation table
 *   needed.
 *
 * NOTE: Unofficial but widely used public API, no published SLA. All
 * fields are null-checked; a bad shape skips the affected record rather
 * than crash the poller.
 */

import type { GameStatus, NbaGameRecord, NbaPlayerProjection, NbaTeam } from "../types.js";
import { getNbaRosters } from "./espnNbaRosterCache.js";
import { getNbaTeamStats } from "./espnNbaTeamStatsCache.js";
import { computeMatchupFactors, type MatchupFactors, type NbaTeamDefensePace } from "./espnNbaTeamStats.js";
import { fetchNbaBoxscore, type NbaLiveActual } from "./espnNbaLiveStats.js";
import { checkNbaScoreSum } from "../lib/statsSanity.js";
import { negBinomAtLeast } from "../lib/probability.js";

const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";

interface EspnCompetitor {
  homeAway: "home" | "away";
  score?: string;
  team: { id: string; displayName: string; abbreviation: string };
}
interface EspnCompetition {
  competitors: EspnCompetitor[];
}
interface EspnEvent {
  id: string;
  date: string;
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

function toTeam(c: EspnCompetitor): NbaTeam {
  return { name: c.team.displayName, abbr: c.team.abbreviation };
}

function applyLiveActual(player: NbaPlayerProjection, actual: NbaLiveActual | undefined): NbaPlayerProjection {
  return {
    ...player,
    actualPts: actual?.pts ?? 0,
    actualAst: actual?.ast ?? 0,
    actualReb: actual?.reb ?? 0,
    actual3PM: actual?.fg3m ?? 0,
  };
}

/** Real in-game (or final) box score for a Live/Final game's rosters, keyed
 *  by athleteId (parsed back out of the roster projection's
 *  `${teamAbbr}-${athleteId}` id). One summary call covers both teams.
 *  Also returns each side's FULL-box-score point total (every player, not
 *  just the tracked starting five) for the score-sum consistency check --
 *  see lib/statsSanity.ts. Returns all-zero actuals/totals if the fetch
 *  fails -- never blocks the schedule/score data on this. */
async function withLiveActuals(
  eventId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeRoster: NbaPlayerProjection[],
  awayRoster: NbaPlayerProjection[],
): Promise<{ home: NbaPlayerProjection[]; away: NbaPlayerProjection[]; homeBoxscorePts: number; awayBoxscorePts: number }> {
  function athleteIdOf(p: NbaPlayerProjection): string {
    return p.id.slice(p.team.length + 1);
  }
  const { playerStats, teamTotals } = await fetchNbaBoxscore(eventId);
  return {
    home: homeRoster.map((p) => applyLiveActual(p, playerStats.get(athleteIdOf(p)))),
    away: awayRoster.map((p) => applyLiveActual(p, playerStats.get(athleteIdOf(p)))),
    homeBoxscorePts: teamTotals.get(homeTeamId) ?? 0,
    awayBoxscorePts: teamTotals.get(awayTeamId) ?? 0,
  };
}

// ~4-5am US Eastern, the same "sports day" boundary nbaProvider.ts's
// synthetic slate uses -- a late NBA game can run past midnight UTC, so a
// naive UTC calendar day would mislabel it as "tomorrow" while it's still
// in progress. Shifting back 9 hours before taking the UTC date keeps
// "today" meaning the evening's slate until well after it's done.
const SPORTS_DAY_SHIFT_MS = 9 * 60 * 60 * 1000;

function sportsDayDateStr(date: Date): string {
  return new Date(date.getTime() - SPORTS_DAY_SHIFT_MS).toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Sunday-through-Saturday, the standard US calendar week (not a rolling
 *  7-day window) -- given any date in it, returns that week's Sunday.
 *  Matches NFL's own "week" concept: already-played days earlier in the
 *  week stay visible (as Final), not dropped once they're in the past. */
function startOfCalendarWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay(): 0 = Sunday
  return d.toISOString().slice(0, 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Re-projects one roster for tonight's REAL matchup, using the factors
 *  computed by computeMatchupFactors() in espnNbaTeamStats.ts. Each
 *  player's season-average projection is scaled by the relevant real
 *  factor (points: opponent defense x pace; assists/rebounds/3PM: pace
 *  only -- see that file's doc for why), and the probability is
 *  recomputed from the SAME player's own variance/mean ratio (so a
 *  streaky player's probability stays appropriately less extreme than a
 *  consistent player's, even after the projection itself moves). Leaves
 *  a roster completely unchanged -- same as before this feature existed
 *  -- if factors is null (team stats not available yet this cycle). */
function applyMatchupFactors(roster: NbaPlayerProjection[], factors: MatchupFactors): NbaPlayerProjection[] {
  const rescale = (proj: number, variance: number, factor: number): { proj: number; variance: number; prob: number } => {
    const adjProj = round1(proj * factor);
    // variance === 0 means "no real game-log variance known yet" (see
    // espnNbaGameLog.ts) -- preserve that "unknown" signal rather than
    // inventing a number, and let negBinomAtLeast fall back to Poisson.
    const dispersionRatio = variance > 0 && proj > 0 ? variance / proj : 1;
    const adjVariance = variance > 0 ? dispersionRatio * adjProj : 0;
    const prob = negBinomAtLeast(adjProj, adjVariance || adjProj, Math.ceil(adjProj));
    return { proj: adjProj, variance: adjVariance, prob };
  };

  return roster.map((p) => {
    const pts = rescale(p.projPts, p.varPts, factors.ptsFactor);
    const ast = rescale(p.projAst, p.varAst, factors.paceFactor);
    const reb = rescale(p.projReb, p.varReb, factors.paceFactor);
    const tpm = rescale(p.proj3PM, p.var3PM, factors.paceFactor);
    return {
      ...p,
      projPts: pts.proj, probPts: pts.prob, varPts: pts.variance,
      projAst: ast.proj, probAst: ast.prob, varAst: ast.variance,
      projReb: reb.proj, probReb: reb.prob, varReb: reb.variance,
      proj3PM: tpm.proj, prob3PM: tpm.prob, var3PM: tpm.variance,
    };
  });
}

/** Fetch one calendar day's NBA slate (YYYYMMDD, already "sports day"
 *  adjusted by the caller). Returns an empty array rather than throwing on
 *  a non-OK response or network failure -- one bad day shouldn't drop the
 *  rest of the week; fetchRealNbaGames() below only falls back to the
 *  synthetic slate if every day comes back empty. */
async function fetchNbaGamesForDate(
  dateStr: string,
  rosters: Map<string, NbaPlayerProjection[]>,
  teamStats: Map<string, NbaTeamDefensePace>,
): Promise<NbaGameRecord[]> {
  let data: ScoreboardResponse;
  try {
    const res = await fetch(`${SCOREBOARD_URL}?dates=${dateStr.replace(/-/g, "")}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[nba] scoreboard fetch for ${dateStr} failed: HTTP ${res.status}`);
      return [];
    }
    data = (await res.json()) as ScoreboardResponse;
  } catch (err) {
    console.warn(`[nba] scoreboard fetch for ${dateStr} failed:`, err);
    return [];
  }

  const now = new Date().toISOString();
  const games: NbaGameRecord[] = [];
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
    // Real matchup-adjustment for tonight's ACTUAL opponent (see
    // espnNbaTeamStats.ts) -- null means team stats aren't available this
    // cycle yet, in which case both rosters just keep their unadjusted
    // season-average projections (same as before this feature existed).
    const factors = computeMatchupFactors(homeTeam.abbr, awayTeam.abbr, teamStats);
    if (factors) {
      homeRoster = applyMatchupFactors(homeRoster, factors.home);
      awayRoster = applyMatchupFactors(awayRoster, factors.away);
    }
    // Internal consistency check against ESPN's own box score -- see
    // lib/statsSanity.ts. Compared against the FULL box score's point
    // total, not just the tracked starting five (a subset under-counts
    // whenever a bench player scores, which is almost every real game).
    let statsSanityWarning: string | null = null;
    if (status === "Live" || status === "Final") {
      const merged = await withLiveActuals(event.id, home.team.id, away.team.id, homeRoster, awayRoster);
      homeRoster = merged.home;
      awayRoster = merged.away;
      const finalHomeScore = Number.isFinite(homeScore) ? homeScore : undefined;
      const finalAwayScore = Number.isFinite(awayScore) ? awayScore : undefined;
      statsSanityWarning =
        checkNbaScoreSum(merged.homeBoxscorePts, finalHomeScore, homeTeam.name) ??
        checkNbaScoreSum(merged.awayBoxscorePts, finalAwayScore, awayTeam.name);
    }

    games.push({
      gameId: `nba-${event.id}`,
      gameDate: event.date,
      status,
      isRealMatchup: true,
      liveClock,
      home: homeTeam,
      away: awayTeam,
      homeScore: Number.isFinite(homeScore) ? homeScore : undefined,
      awayScore: Number.isFinite(awayScore) ? awayScore : undefined,
      homeRoster,
      awayRoster,
      lines: [],
      consensus: { homeWinPct: null, awayWinPct: null, prevHomeWinPct: null, prevAwayWinPct: null },
      statsSanityWarning,
      fetchedAt: now,
    });
  }
  return games;
}

/** Fetch the real NBA slate for the full current CALENDAR week (Sunday
 *  through Saturday, containing "today" -- sports-day adjusted, from
 *  `date` if given, else wall-clock now), one ESPN scoreboard call per
 *  day, merged and sorted by tip-off time. Earlier days in the week that
 *  already happened are included too (they'll just show as Final) --
 *  same idea as NFL's "week" tab, a stable weekly block rather than a
 *  sliding 7-day lookahead that would span two different weeks. Falls
 *  back to nothing (letting nbaProvider.ts switch to the synthetic slate)
 *  only if every single day's fetch came back empty -- a single bad day
 *  doesn't take out the rest of the week.
 *
 *  Saturday exception: Saturday is the week's last day, so on its own the
 *  week block would leave "Upcoming" showing only whatever's left of
 *  Saturday -- often just a couple of late games, or none once they've
 *  all tipped off. So on Saturday specifically, also pull in Sunday
 *  (tomorrow, the START of next week) so Upcoming still has a full
 *  day's slate to show. This stops being needed the moment Sunday
 *  itself arrives, since startOfCalendarWeek() then anchors the whole
 *  fetch to the new week anyway -- it's only a one-day bridge over the
 *  Saturday-to-Sunday rollover. */
export async function fetchRealNbaGames(date?: Date): Promise<NbaGameRecord[]> {
  const todayStr = sportsDayDateStr(date ?? new Date());
  const startStr = startOfCalendarWeek(todayStr);
  const [rosters, teamStats] = await Promise.all([getNbaRosters(), getNbaTeamStats()]);
  const dateStrs = Array.from({ length: 7 }, (_, i) => addDays(startStr, i));
  const isSaturday = new Date(`${todayStr}T00:00:00Z`).getUTCDay() === 6;
  if (isSaturday) {
    dateStrs.push(addDays(todayStr, 1));
  }
  const perDay = await Promise.all(dateStrs.map((d) => fetchNbaGamesForDate(d, rosters, teamStats)));
  const games = perDay.flat();
  return games.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
}

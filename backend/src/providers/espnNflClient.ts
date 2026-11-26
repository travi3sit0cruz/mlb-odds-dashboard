/**
 * Real NFL team/roster/season-stat client, backed by ESPN's public,
 * unauthenticated JSON APIs — same approach as espnWnbaClient.ts.
 *
 * Two ESPN hosts are used:
 *   - site.api.espn.com  → team roster grouped by offense/defense/specialTeam
 *     with position already attached (no extra profile call needed).
 *   - sports.core.api.espn.com → per-athlete season statistics.
 *
 * Only offense skill positions (QB/RB/FB/WR/TE) are fetched — offensive
 * line, defense, and special teams don't have a meaningful single-game
 * "prop" stat the rest of this app's model (season per-game average +
 * Poisson at-least-average probability) applies to.
 *
 * Everything here is REAL: real teams, real players, real season stats.
 * No fabricated numbers. See espnWnbaClient.ts for the same ToS note
 * (read-only public stats, not licensed/scraped sportsbook data).
 */

import type { NflPlayerProjection } from "../types.js";
import { poissonAtLeast } from "../lib/probability.js";

const SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE_BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";

export const ESPN_NFL_TEAMS: { espnId: number; name: string; abbr: string }[] = [
  { espnId: 1,  name: "Atlanta Falcons",        abbr: "ATL" },
  { espnId: 2,  name: "Buffalo Bills",          abbr: "BUF" },
  { espnId: 3,  name: "Chicago Bears",          abbr: "CHI" },
  { espnId: 4,  name: "Cincinnati Bengals",     abbr: "CIN" },
  { espnId: 5,  name: "Cleveland Browns",       abbr: "CLE" },
  { espnId: 6,  name: "Dallas Cowboys",         abbr: "DAL" },
  { espnId: 7,  name: "Denver Broncos",         abbr: "DEN" },
  { espnId: 8,  name: "Detroit Lions",          abbr: "DET" },
  { espnId: 9,  name: "Green Bay Packers",      abbr: "GB"  },
  { espnId: 10, name: "Tennessee Titans",       abbr: "TEN" },
  { espnId: 11, name: "Indianapolis Colts",     abbr: "IND" },
  { espnId: 12, name: "Kansas City Chiefs",     abbr: "KC"  },
  { espnId: 13, name: "Las Vegas Raiders",      abbr: "LV"  },
  { espnId: 14, name: "Los Angeles Rams",       abbr: "LAR" },
  { espnId: 15, name: "Miami Dolphins",         abbr: "MIA" },
  { espnId: 16, name: "Minnesota Vikings",      abbr: "MIN" },
  { espnId: 17, name: "New England Patriots",   abbr: "NE"  },
  { espnId: 18, name: "New Orleans Saints",     abbr: "NO"  },
  { espnId: 19, name: "New York Giants",        abbr: "NYG" },
  { espnId: 20, name: "New York Jets",          abbr: "NYJ" },
  { espnId: 21, name: "Philadelphia Eagles",    abbr: "PHI" },
  { espnId: 22, name: "Arizona Cardinals",      abbr: "ARI" },
  { espnId: 23, name: "Pittsburgh Steelers",    abbr: "PIT" },
  { espnId: 24, name: "Los Angeles Chargers",   abbr: "LAC" },
  { espnId: 25, name: "San Francisco 49ers",    abbr: "SF"  },
  { espnId: 26, name: "Seattle Seahawks",       abbr: "SEA" },
  { espnId: 27, name: "Tampa Bay Buccaneers",   abbr: "TB"  },
  { espnId: 28, name: "Washington Commanders",  abbr: "WSH" },
  { espnId: 29, name: "Carolina Panthers",      abbr: "CAR" },
  { espnId: 30, name: "Jacksonville Jaguars",   abbr: "JAX" },
  { espnId: 33, name: "Baltimore Ravens",       abbr: "BAL" },
  { espnId: 34, name: "Houston Texans",         abbr: "HOU" },
];

const SKILL_POSITIONS = new Set(["QB", "RB", "FB", "WR", "TE"]);

function currentSeason(): number {
  return new Date().getUTCFullYear();
}

// ─── Rate limiting (same reasoning as espnWnbaClient.ts) ───────────────────
const MIN_SPACING_MS = 150;
let lastCallAt = 0;
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function rateLimitedFetch(url: string): Promise<any> {
  const wait = MIN_SPACING_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

interface RosterAthlete {
  id: string;
  displayName: string;
  position?: { abbreviation: string };
}
interface RosterGroup {
  position: string; // "offense" | "defense" | ...
  items: RosterAthlete[];
}
interface RosterResponse {
  athletes?: RosterGroup[];
}

/** Skill-position (QB/RB/FB/WR/TE) athlete id+name+position for one team's offense. */
async function fetchSkillAthletes(espnTeamId: number): Promise<{ id: string; name: string; position: string }[]> {
  const data = (await rateLimitedFetch(`${SITE_BASE}/teams/${espnTeamId}/roster`)) as RosterResponse;
  const offense = data.athletes?.find((g) => g.position === "offense");
  return (offense?.items ?? [])
    .filter((a) => a.position?.abbreviation && SKILL_POSITIONS.has(a.position.abbreviation))
    .map((a) => ({ id: a.id, name: a.displayName, position: a.position!.abbreviation }));
}

interface AthleteSeasonStats {
  gamesPlayed: number;
  passingYards: number; passingTouchdowns: number; completions: number;
  rushingYards: number; rushingTouchdowns: number; rushingAttempts: number;
  receivingYards: number; receivingTouchdowns: number; receptions: number;
}

/** type=2 is regular season. Returns null if the athlete hasn't played yet this season. */
async function fetchAthleteSeasonStats(athleteId: string, season: number): Promise<AthleteSeasonStats | null> {
  const data = await rateLimitedFetch(
    `${CORE_BASE}/seasons/${season}/types/2/athletes/${athleteId}/statistics?lang=en&region=us`,
  );
  const categories: { name: string; stats: { name: string; value: number }[] }[] = data.splits?.categories ?? [];
  const byCat = new Map<string, Map<string, number>>();
  for (const cat of categories) {
    byCat.set(cat.name, new Map(cat.stats.map((s) => [s.name, s.value])));
  }
  const general = byCat.get("general");
  const gamesPlayed = general?.get("gamesPlayed") ?? 0;
  if (gamesPlayed < 1) return null;

  const passing = byCat.get("passing");
  const rushing = byCat.get("rushing");
  const receiving = byCat.get("receiving");
  return {
    gamesPlayed,
    passingYards: passing?.get("passingYards") ?? 0,
    passingTouchdowns: passing?.get("passingTouchdowns") ?? 0,
    completions: passing?.get("completions") ?? 0,
    rushingYards: rushing?.get("rushingYards") ?? 0,
    rushingTouchdowns: rushing?.get("rushingTouchdowns") ?? 0,
    rushingAttempts: rushing?.get("rushingAttempts") ?? 0,
    receivingYards: receiving?.get("receivingYards") ?? 0,
    receivingTouchdowns: receiving?.get("receivingTouchdowns") ?? 0,
    receptions: receiving?.get("receptions") ?? 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toProjection(
  id: string, name: string, team: string, position: string, stats: AthleteSeasonStats,
): NflPlayerProjection {
  const g = stats.gamesPlayed;
  const isQb = position === "QB";
  const isReceiver = position === "WR" || position === "TE";

  const ydsLabel = isQb ? "Pass Yds" : isReceiver ? "Rec Yds" : "Rush Yds";
  const thirdLabel = isQb ? "Comp" : isReceiver ? "Rec" : "Att";
  const tdLabel = isQb ? "Pass TD" : "TD";

  const seasonYds = isQb ? stats.passingYards : isReceiver ? stats.receivingYards : stats.rushingYards;
  const seasonTD = isQb ? stats.passingTouchdowns : stats.rushingTouchdowns + stats.receivingTouchdowns;
  const seasonRecOrAtt = isQb ? stats.completions : isReceiver ? stats.receptions : stats.rushingAttempts;

  const projYds = round1(seasonYds / g);
  const projTD = round1(seasonTD / g);
  const projRecOrAtt = round1(seasonRecOrAtt / g);

  return {
    id: `${team}-${id}`,
    name,
    team,
    position,
    seasonG: g,
    seasonYds, seasonTD, seasonRecOrAtt,
    projYds, projTD, projRecOrAtt,
    probYds: poissonAtLeast(projYds, Math.ceil(projYds)),
    probTD: poissonAtLeast(projTD, Math.ceil(projTD)),
    probRecOrAtt: poissonAtLeast(projRecOrAtt, Math.ceil(projRecOrAtt)),
    ydsLabel, tdLabel, thirdLabel,
    // Filled in per-game by espnNflProvider.ts for Live games only; 0 here
    // since this is the season-roster snapshot, not tonight's specific game.
    actualYds: 0, actualTD: 0, actualRecOrAtt: 0,
  };
}

async function buildTeamSkillRoster(espnTeamId: number, teamAbbr: string, season: number): Promise<NflPlayerProjection[]> {
  const athletes = await fetchSkillAthletes(espnTeamId);
  const roster: NflPlayerProjection[] = [];
  for (const athlete of athletes) {
    try {
      const stats = await fetchAthleteSeasonStats(athlete.id, season);
      if (!stats) continue; // hasn't played this season — nothing real to project
      roster.push(toProjection(athlete.id, athlete.name, teamAbbr, athlete.position, stats));
    } catch (err) {
      console.warn(`[espn-nfl] athlete ${athlete.id} (team ${teamAbbr}) fetch failed:`, err);
    }
  }
  // QB first, then skill players by projected yards descending — keeps the
  // most game-relevant props at the top of the table.
  roster.sort((a, b) => {
    if (a.position === "QB" && b.position !== "QB") return -1;
    if (b.position === "QB" && a.position !== "QB") return 1;
    return b.projYds - a.projYds;
  });
  return filterStarters(roster);
}

/** Typical starting skill-player group size per team -- caps the roster to
 *  realistic starters instead of every player who's logged a game this
 *  season (benchwarmers, 3rd-string TEs, etc). RB and FB share one bucket
 *  since both are backfield rushers. Ranked by the sort order already
 *  applied above (projected yards descending within each bucket). */
const STARTER_LIMITS: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1 };

function filterStarters(roster: NflPlayerProjection[]): NflPlayerProjection[] {
  const counts: Record<string, number> = {};
  return roster.filter((p) => {
    const bucket = p.position === "FB" ? "RB" : p.position;
    const limit  = STARTER_LIMITS[bucket] ?? 0;
    const count  = counts[bucket] ?? 0;
    if (count >= limit) return false;
    counts[bucket] = count + 1;
    return true;
  });
}

/** Fetch every active NFL team's real skill-position roster + real season
 *  averages. Sequential + rate-limited: a full 32-team refresh is a few
 *  hundred calls, roughly a minute. Callers should cache this. */
export async function fetchAllNflRosters(): Promise<Map<string, NflPlayerProjection[]>> {
  const season = currentSeason();
  const result = new Map<string, NflPlayerProjection[]>();
  for (const team of ESPN_NFL_TEAMS) {
    try {
      const roster = await buildTeamSkillRoster(team.espnId, team.abbr, season);
      if (roster.length > 0) result.set(team.abbr, roster);
    } catch (err) {
      console.warn(`[espn-nfl] roster fetch failed for ${team.name}:`, err);
    }
  }
  return result;
}

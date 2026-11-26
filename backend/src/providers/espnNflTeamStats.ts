/**
 * Real team-level defense + pace stats for NFL matchup adjustment, backed by
 * ESPN's public sports.core.api.espn.com (same host/rate-limiter style as
 * espnNbaTeamStats.ts).
 *
 * Why this is a coarser adjustment than NBA's: ESPN's NFL team statistics
 * endpoint's "defensive" category DOES list `yardsAllowed` and
 * `pointsAllowed` fields -- but both come back as a flat 0 for every team,
 * every time, confirmed by checking multiple teams live. That field is
 * simply unpopulated in this API, not a real number. The one real "allowed"
 * figure that DOES work is `avgPointsAgainst` on the team RECORD endpoint
 * (same one standings pages use, same endpoint shape as NBA's). There is no
 * real passYardsAllowed/rushYardsAllowed/touchdownsAllowed split anywhere
 * in ESPN's public API for NFL either.
 *
 * Rather than fabricate a yards-specific or TD-specific defense number,
 * every yardage/TD prop (passing, rushing, receiving) shares the SAME real
 * points-allowed-based defense factor -- points allowed is a reasonable
 * real proxy for "how good is this defense overall" even though it isn't
 * split by play type, and that's honestly what it is: an overall defense
 * strength signal, not a play-type-specific one. Usage-count props
 * (completions/rush attempts/receptions) get pace-only, same reasoning as
 * NBA's assists/rebounds/3PM -- no real "allowed" signal applies to how
 * many touches a player gets, only to how the defense performs once he has
 * the ball.
 *
 * Pace proxy: `totalOffensivePlays` (team statistics endpoint's "passing"
 * category, perGameValue) -- a real per-game figure, the NFL analogue of
 * NBA's estimatedPossessions (more plays = more opportunities for every
 * counting stat).
 */

import { ESPN_NFL_TEAMS } from "./espnNflClient.js";

const CORE_BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";

const MIN_SPACING_MS = 200;
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

export interface NflTeamDefensePace {
  avgPointsAgainst: number;
  playsPerGame: number;
}

async function fetchTeamAvgPointsAgainst(espnTeamId: number, season: number): Promise<number | null> {
  const data = await rateLimitedFetch(
    `${CORE_BASE}/seasons/${season}/types/2/teams/${espnTeamId}/record?lang=en&region=us`,
  );
  const overall = (data.items ?? []).find((item: any) => item.name === "overall");
  const value = overall?.stats?.find((s: any) => s.name === "avgPointsAgainst")?.value;
  return typeof value === "number" ? value : null;
}

async function fetchTeamPlaysPerGame(espnTeamId: number, season: number): Promise<number | null> {
  const data = await rateLimitedFetch(
    `${CORE_BASE}/seasons/${season}/types/2/teams/${espnTeamId}/statistics?lang=en&region=us`,
  );
  const categories: { name: string; stats: { name: string; perGameValue?: number }[] }[] =
    data.splits?.categories ?? [];
  const passing = categories.find((c) => c.name === "passing");
  const value = passing?.stats.find((s) => s.name === "totalOffensivePlays")?.perGameValue;
  return typeof value === "number" ? value : null;
}

/** Fetch every active NFL team's real points-allowed + plays-per-game.
 *  Sequential + rate-limited: 2 calls/team x 32 teams. Callers should
 *  cache this (see espnNflTeamStatsCache.ts). */
export async function fetchAllNflTeamStats(): Promise<Map<string, NflTeamDefensePace>> {
  const season = new Date().getUTCFullYear();
  const result = new Map<string, NflTeamDefensePace>();
  for (const team of ESPN_NFL_TEAMS) {
    try {
      const [avgPointsAgainst, playsPerGame] = await Promise.all([
        fetchTeamAvgPointsAgainst(team.espnId, season),
        fetchTeamPlaysPerGame(team.espnId, season),
      ]);
      if (avgPointsAgainst !== null && playsPerGame !== null) {
        result.set(team.abbr, { avgPointsAgainst, playsPerGame });
      }
    } catch (err) {
      console.warn(`[espn-nfl] team stats fetch failed for ${team.name}:`, err);
    }
  }
  return result;
}

export interface MatchupFactors {
  /** Applies to passing/rushing/receiving yards AND touchdowns -- see file
   *  doc for why both share one real-defense-based factor. */
  ydsTdFactor: number;
  /** Applies to completions/rush attempts/receptions -- pace only, no
   *  defense-strength component (no real "allowed" data for usage counts). */
  paceFactor: number;
}

// Same reasoning as espnNbaTeamStats.ts's clamp: keeps a single noisy team
// (e.g. a 2-game sample early in the season) from swinging any player's
// projection wildly.
const MIN_FACTOR = 0.75;
const MAX_FACTOR = 1.3;

function clamp(x: number): number {
  return Math.min(Math.max(x, MIN_FACTOR), MAX_FACTOR);
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Given real per-team defense+pace figures for every team, and tonight's
 *  two actual opponents, compute each side's real matchup-adjustment
 *  factors. Returns null (meaning: use unadjusted season averages) if
 *  either team's real stats aren't available yet. */
export function computeMatchupFactors(
  homeAbbr: string,
  awayAbbr: string,
  teamStats: Map<string, NflTeamDefensePace>,
): { home: MatchupFactors; away: MatchupFactors } | null {
  const home = teamStats.get(homeAbbr);
  const away = teamStats.get(awayAbbr);
  if (!home || !away || teamStats.size === 0) return null;

  const leagueAvgPointsAgainst = average([...teamStats.values()].map((t) => t.avgPointsAgainst));
  const leagueAvgPlays = average([...teamStats.values()].map((t) => t.playsPerGame));
  if (leagueAvgPointsAgainst <= 0 || leagueAvgPlays <= 0) return null;

  // A home player's yards/TDs are driven by the AWAY team's defense, and
  // vice versa. Pace is a property of the matchup (how many plays both
  // offenses run), so it's the same for both sides -- averaged.
  const pace = clamp(average([home.playsPerGame, away.playsPerGame]) / leagueAvgPlays);
  const homeOppDefense = clamp(away.avgPointsAgainst / leagueAvgPointsAgainst);
  const awayOppDefense = clamp(home.avgPointsAgainst / leagueAvgPointsAgainst);

  return {
    home: { ydsTdFactor: clamp(homeOppDefense * pace), paceFactor: pace },
    away: { ydsTdFactor: clamp(awayOppDefense * pace), paceFactor: pace },
  };
}

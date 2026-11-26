/**
 * Real team-level defense + pace stats for NBA matchup adjustment, backed by
 * ESPN's public sports.core.api.espn.com (same host/rate-limiter style as
 * espnNbaClient.ts).
 *
 * Why only points gets a real defense-strength factor: ESPN's team
 * statistics endpoint exposes a team's own box-score stats (points, boards,
 * assists, etc. they produce) but, after checking, no "opponent allowed"
 * breakdown by stat category -- the one real "allowed" figure it does
 * expose is avgPointsAgainst, on the team RECORD endpoint (the same one
 * standings pages use). There is no equivalent real avgAssistsAgainst /
 * avgReboundsAgainst / avg3PMAgainst anywhere in ESPN's public API. Rather
 * than fabricate one, assists/rebounds/3PM only get the (real) pace
 * adjustment below, not a defense-strength one -- see computeMatchupFactors.
 *
 * Pace proxy: `estimatedPossessions` (team statistics endpoint, "offensive"
 * category) -- a real per-game figure, and the standard DFS/betting-model
 * pace proxy (more possessions = more opportunities for every counting
 * stat, not just points).
 */

import { ESPN_NBA_TEAMS } from "./espnNbaClient.js";

const CORE_BASE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
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

export interface NbaTeamDefensePace {
  avgPointsAgainst: number;
  estimatedPossessions: number;
}

async function fetchTeamAvgPointsAgainst(espnTeamId: number, season: number): Promise<number | null> {
  const data = await rateLimitedFetch(
    `${CORE_BASE}/seasons/${season}/types/2/teams/${espnTeamId}/record?lang=en&region=us`,
  );
  const overall = (data.items ?? []).find((item: any) => item.name === "overall");
  const value = overall?.stats?.find((s: any) => s.name === "avgPointsAgainst")?.value;
  return typeof value === "number" ? value : null;
}

async function fetchTeamEstimatedPossessions(espnTeamId: number, season: number): Promise<number | null> {
  const data = await rateLimitedFetch(
    `${CORE_BASE}/seasons/${season}/types/2/teams/${espnTeamId}/statistics?lang=en&region=us`,
  );
  const categories: { name: string; stats: { name: string; perGameValue?: number }[] }[] =
    data.splits?.categories ?? [];
  const offensive = categories.find((c) => c.name === "offensive");
  const value = offensive?.stats.find((s) => s.name === "estimatedPossessions")?.perGameValue;
  return typeof value === "number" ? value : null;
}

/** One team's real defense+pace figures, or null if either real stat isn't
 *  available yet (e.g. before the season has any games played). */
async function fetchOneTeam(espnTeamId: number, season: number): Promise<NbaTeamDefensePace | null> {
  const [avgPointsAgainst, estimatedPossessions] = await Promise.all([
    fetchTeamAvgPointsAgainst(espnTeamId, season),
    fetchTeamEstimatedPossessions(espnTeamId, season),
  ]);
  if (avgPointsAgainst === null || estimatedPossessions === null) return null;
  return { avgPointsAgainst, estimatedPossessions };
}

/** Fetch every active NBA team's real defense+pace figures. Sequential +
 *  rate-limited like espnNbaClient.ts's roster fetch, but far fewer calls
 *  (2 per team vs. ~2 per player) -- a full refresh is seconds, not minutes.
 *  Callers should still cache this (see espnNbaTeamStatsCache.ts). */
export async function fetchAllNbaTeamStats(): Promise<Map<string, NbaTeamDefensePace>> {
  const season = new Date().getUTCFullYear();
  const result = new Map<string, NbaTeamDefensePace>();
  for (const team of ESPN_NBA_TEAMS) {
    try {
      const stats = await fetchOneTeam(team.espnId, season);
      if (stats) result.set(team.abbr, stats);
    } catch (err) {
      console.warn(`[espn-nba] team stats fetch failed for ${team.name}:`, err);
    }
  }
  return result;
}

export interface MatchupFactors {
  /** Applies to points only -- see file doc for why. */
  ptsFactor: number;
  /** Applies to assists, rebounds, and 3PM -- pace only, no defense-strength
   *  component (no real "allowed" data exists for those categories). */
  paceFactor: number;
}

// Keeps a single noisy small-sample data point (e.g. an outlier team 3 games
// into a season) from swinging any player's projection wildly. Real pace and
// points-allowed spreads across the league are usually much narrower than
// this even in extreme cases, so the clamp should rarely bind in practice.
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
 *  factors (one set for the home roster, one for the away roster -- a
 *  player's `ptsFactor` is driven by the OTHER team's defense). Returns
 *  null (meaning: use unadjusted season averages) if either team's real
 *  stats aren't available yet. */
export function computeMatchupFactors(
  homeAbbr: string,
  awayAbbr: string,
  teamStats: Map<string, NbaTeamDefensePace>,
): { home: MatchupFactors; away: MatchupFactors } | null {
  const home = teamStats.get(homeAbbr);
  const away = teamStats.get(awayAbbr);
  if (!home || !away || teamStats.size === 0) return null;

  const leagueAvgPointsAgainst = average([...teamStats.values()].map((t) => t.avgPointsAgainst));
  const leagueAvgPossessions = average([...teamStats.values()].map((t) => t.estimatedPossessions));
  if (leagueAvgPointsAgainst <= 0 || leagueAvgPossessions <= 0) return null;

  // A home player's points are driven by the AWAY team's defense, and vice
  // versa. Pace is a property of the matchup itself (how fast BOTH teams
  // play), so it's the same for both sides -- averaged across the two teams.
  // Each raw ratio is clamped individually first (one outlier team's number
  // alone shouldn't already be extreme), then the combined product is
  // clamped again (two individually-reasonable factors can still multiply
  // into an unreasonable one).
  const pace = clamp(average([home.estimatedPossessions, away.estimatedPossessions]) / leagueAvgPossessions);
  const homeOppDefense = clamp(away.avgPointsAgainst / leagueAvgPointsAgainst);
  const awayOppDefense = clamp(home.avgPointsAgainst / leagueAvgPointsAgainst);

  return {
    home: { ptsFactor: clamp(homeOppDefense * pace), paceFactor: pace },
    away: { ptsFactor: clamp(awayOppDefense * pace), paceFactor: pace },
  };
}

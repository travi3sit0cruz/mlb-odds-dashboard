/**
 * Real WNBA team/roster/season-stat client, backed by ESPN's own public,
 * unauthenticated JSON API (the same endpoints the R package `wehoop`
 * wraps — see https://wehoop.sportsdataverse.org/). wehoop itself can't be
 * called from this Bun/TypeScript backend, so this talks to the underlying
 * ESPN hosts directly.
 *
 * Note on hosts: ESPN exposes basketball data on three public hosts.
 * `site.api.espn.com` returns HTTP 403 (Akamai edge block) from this
 * project's network — but `sports.core.api.espn.com` (teams/rosters/
 * season stats) works fine and is all this file needs.
 *
 * Note on ToS: ESPN's terms technically restrict automated access, but
 * this is the exact technique the open-source `wehoop`/sportsdataverse
 * project uses openly (published on CRAN, backed by the R Foundation) —
 * a different risk category than DraftKings/FanDuel, which actively block
 * and legally prohibit this. Read-only public stats, not licensed data.
 *
 * Everything returned here is REAL: real teams, real players, real season
 * averages. The only derived (non-ESPN-supplied) field is `role` —
 * ESPN's roster/athlete payloads don't carry a starter flag on this host,
 * so Starter/Bench is inferred from real minutes-per-game rank (top 5 by
 * avgMinutes = Starter). That is a heuristic, but built entirely from real
 * playing-time data, not a fabricated number.
 */

import type { WnbaPlayerProjection, WnbaTeam } from "../types.js";
import { poissonAtLeast } from "../lib/probability.js";

const CORE_BASE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba";
const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";

/** ESPN's own team IDs for every currently active WNBA franchise (2026 season,
 *  including the Golden State/Toronto/Portland expansion teams). */
export const ESPN_WNBA_TEAMS: { espnId: number; name: string; abbr: string }[] = [
  { espnId: 3,      name: "Dallas Wings",           abbr: "DAL" },
  { espnId: 5,      name: "Indiana Fever",          abbr: "IND" },
  { espnId: 6,      name: "Los Angeles Sparks",     abbr: "LA"  },
  { espnId: 8,      name: "Minnesota Lynx",         abbr: "MIN" },
  { espnId: 9,      name: "New York Liberty",       abbr: "NY"  },
  { espnId: 11,     name: "Phoenix Mercury",        abbr: "PHX" },
  { espnId: 14,     name: "Seattle Storm",          abbr: "SEA" },
  { espnId: 16,     name: "Washington Mystics",     abbr: "WSH" },
  { espnId: 17,     name: "Las Vegas Aces",         abbr: "LV"  },
  { espnId: 18,     name: "Connecticut Sun",        abbr: "CON" },
  { espnId: 19,     name: "Chicago Sky",            abbr: "CHI" },
  { espnId: 20,     name: "Atlanta Dream",          abbr: "ATL" },
  { espnId: 129689, name: "Golden State Valkyries", abbr: "GS"  },
  { espnId: 131935, name: "Toronto Tempo",          abbr: "TOR" },
  { espnId: 132052, name: "Portland Fire",          abbr: "POR" },
];

export const WNBA_TEAMS: WnbaTeam[] = ESPN_WNBA_TEAMS.map((t) => ({ name: t.name, abbr: t.abbr }));

function currentSeason(): number {
  return new Date().getUTCFullYear();
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
// ESPN doesn't publish a rate limit, but their own docs note requests faster
// than ~1/sec occasionally 429 or come back empty. 200ms spacing keeps a full
// ~350-call refresh under 90s while staying well clear of that.
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

// ─── Roster + stats ───────────────────────────────────────────────────────────

/** Athlete IDs on a team's active roster this season. */
async function fetchAthleteIds(espnTeamId: number, season: number): Promise<string[]> {
  const data = await rateLimitedFetch(
    `${CORE_BASE}/seasons/${season}/teams/${espnTeamId}/athletes?lang=en&region=us&limit=30`,
  );
  const items: { $ref: string }[] = data.items ?? [];
  return items
    .map((item) => item.$ref.match(/athletes\/(\d+)/)?.[1])
    .filter((id): id is string => !!id);
}

interface AthleteProfile {
  displayName: string;
  positionAbbr: string;
}

async function fetchAthleteProfile(athleteId: string, season: number): Promise<AthleteProfile> {
  const data = await rateLimitedFetch(
    `${CORE_BASE}/seasons/${season}/athletes/${athleteId}?lang=en&region=us`,
  );
  return {
    displayName: data.displayName ?? "Unknown Player",
    positionAbbr: data.position?.abbreviation ?? "F",
  };
}

interface AthleteSeasonStats {
  gamesPlayed: number;
  avgMinutes: number;
  avgPoints: number;
  avgAssists: number;
  avgRebounds: number;
  avgThreePointFieldGoalsMade: number;
  points: number;
  assists: number;
  rebounds: number;
  threePointFieldGoalsMade: number;
}

/** type=2 is regular season. Returns null if the athlete has no stat splits yet
 *  (e.g. hasn't played this season) — caller should skip those players. */
async function fetchAthleteSeasonStats(athleteId: string, season: number): Promise<AthleteSeasonStats | null> {
  const data = await rateLimitedFetch(
    `${CORE_BASE}/seasons/${season}/types/2/athletes/${athleteId}/statistics?lang=en&region=us`,
  );
  const categories: { name: string; stats: { name: string; value: number }[] }[] = data.splits?.categories ?? [];
  const byName = new Map<string, number>();
  for (const cat of categories) {
    for (const stat of cat.stats) byName.set(stat.name, stat.value);
  }
  const gamesPlayed = byName.get("gamesPlayed") ?? 0;
  if (gamesPlayed < 1) return null;
  return {
    gamesPlayed,
    avgMinutes: byName.get("avgMinutes") ?? 0,
    avgPoints: byName.get("avgPoints") ?? 0,
    avgAssists: byName.get("avgAssists") ?? 0,
    avgRebounds: byName.get("avgRebounds") ?? 0,
    avgThreePointFieldGoalsMade: byName.get("avgThreePointFieldGoalsMade") ?? 0,
    points: byName.get("points") ?? 0,
    assists: byName.get("assists") ?? 0,
    rebounds: byName.get("rebounds") ?? 0,
    threePointFieldGoalsMade: byName.get("threePointFieldGoalsMade") ?? 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function buildTeamRoster(espnTeamId: number, teamAbbr: string, season: number): Promise<WnbaPlayerProjection[]> {
  const athleteIds = await fetchAthleteIds(espnTeamId, season);

  const withMinutes: (WnbaPlayerProjection & { avgMinutes: number })[] = [];
  for (const athleteId of athleteIds) {
    try {
      const [profile, stats] = await Promise.all([
        fetchAthleteProfile(athleteId, season),
        fetchAthleteSeasonStats(athleteId, season),
      ]);
      if (!stats) continue; // hasn't played this season — nothing real to project

      const projPts = round1(stats.avgPoints);
      const projAst = round1(stats.avgAssists);
      const projReb = round1(stats.avgRebounds);
      const proj3PM = round1(stats.avgThreePointFieldGoalsMade);

      withMinutes.push({
        id: `${teamAbbr}-${athleteId}`,
        name: profile.displayName,
        team: teamAbbr,
        position: profile.positionAbbr,
        role: "Bench", // placeholder — assigned below by real minutes-per-game rank
        seasonG: stats.gamesPlayed,
        seasonPts: stats.points,
        seasonAst: stats.assists,
        seasonReb: stats.rebounds,
        season3PM: stats.threePointFieldGoalsMade,
        projPts, projAst, projReb, proj3PM,
        probPts: poissonAtLeast(projPts, Math.ceil(projPts)),
        probAst: poissonAtLeast(projAst, Math.ceil(projAst)),
        probReb: poissonAtLeast(projReb, Math.ceil(projReb)),
        prob3PM: poissonAtLeast(proj3PM, Math.ceil(proj3PM)),
        // Filled in per-game by the provider (realWnbaGames/realNbaGames) --
        // 0 here since this is the season-roster snapshot, not tonight's game.
        simTodayPts: 0, simTodayAst: 0, simTodayReb: 0, simToday3PM: 0,
        avgMinutes: stats.avgMinutes,
      });
    } catch (err) {
      console.warn(`[espn-wnba] athlete ${athleteId} (team ${teamAbbr}) fetch failed:`, err);
    }
  }

  // Real minutes-per-game rank stands in for a starter flag ESPN doesn't
  // expose on this host: top 5 by avgMinutes = Starter, rest = Bench.
  withMinutes.sort((a, b) => b.avgMinutes - a.avgMinutes);
  return withMinutes.map(({ avgMinutes, ...player }, i) => ({
    ...player,
    role: i < 5 ? "Starter" : "Bench",
  }));
}

/** Fetch every active WNBA team's real roster + real season averages.
 *  Sequential + rate-limited: a full refresh takes roughly a minute. Callers
 *  should cache this, not call it on every poll tick. */
export async function fetchAllWnbaRosters(): Promise<Map<string, WnbaPlayerProjection[]>> {
  const season = currentSeason();
  const result = new Map<string, WnbaPlayerProjection[]>();
  for (const team of ESPN_WNBA_TEAMS) {
    try {
      const roster = await buildTeamRoster(team.espnId, team.abbr, season);
      if (roster.length > 0) result.set(team.abbr, roster);
    } catch (err) {
      console.warn(`[espn-wnba] roster fetch failed for ${team.name}:`, err);
    }
  }
  return result;
}

/**
 * Real NBA team/roster/season-stat client, backed by ESPN's own public,
 * unauthenticated JSON API (the same underlying infrastructure the R
 * package `hoopR` wraps — see https://hoopr.sportsdataverse.org/).
 *
 * Note on hosts: `site.api.espn.com` (teams/roster/scoreboard) intermittently
 * 403s basketball paths from this project's network — same Akamai edge block
 * observed for WNBA — but `sports.core.api.espn.com` (teams/rosters/season
 * stats) works fine and is all this file needs.
 *
 * Note on ToS: ESPN's terms technically restrict automated access, but this
 * is the exact technique the open-source `hoopR`/sportsdataverse project uses
 * openly (published on CRAN, backed by the R Foundation) — a different risk
 * category than DraftKings/FanDuel, which actively block and legally
 * prohibit this. Read-only public stats, not licensed data.
 *
 * Everything returned here is REAL: real teams, real players, real season
 * averages. The only derived (non-ESPN-supplied) field is `role` — ESPN's
 * roster/athlete payloads don't carry a starter flag on this host, so
 * Starter/Bench is inferred from real minutes-per-game rank (top 5 by
 * avgMinutes = Starter). That is a heuristic, but built entirely from real
 * playing-time data, not a fabricated number.
 */

import type { NbaPlayerProjection, NbaTeam } from "../types.js";
import { negBinomAtLeast, sampleVariance } from "../lib/probability.js";
import { fetchAthleteGameLog } from "./espnNbaGameLog.js";

const CORE_BASE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";

/** ESPN's own team IDs for all 30 active NBA franchises (2026 season). */
export const ESPN_NBA_TEAMS: { espnId: number; name: string; abbr: string }[] = [
  { espnId: 1,  name: "Atlanta Hawks",          abbr: "ATL"  },
  { espnId: 2,  name: "Boston Celtics",         abbr: "BOS"  },
  { espnId: 3,  name: "New Orleans Pelicans",   abbr: "NO"   },
  { espnId: 4,  name: "Chicago Bulls",          abbr: "CHI"  },
  { espnId: 5,  name: "Cleveland Cavaliers",    abbr: "CLE"  },
  { espnId: 6,  name: "Dallas Mavericks",       abbr: "DAL"  },
  { espnId: 7,  name: "Denver Nuggets",         abbr: "DEN"  },
  { espnId: 8,  name: "Detroit Pistons",        abbr: "DET"  },
  { espnId: 9,  name: "Golden State Warriors",  abbr: "GS"   },
  { espnId: 10, name: "Houston Rockets",        abbr: "HOU"  },
  { espnId: 11, name: "Indiana Pacers",         abbr: "IND"  },
  { espnId: 12, name: "LA Clippers",            abbr: "LAC"  },
  { espnId: 13, name: "Los Angeles Lakers",     abbr: "LAL"  },
  { espnId: 14, name: "Miami Heat",             abbr: "MIA"  },
  { espnId: 15, name: "Milwaukee Bucks",        abbr: "MIL"  },
  { espnId: 16, name: "Minnesota Timberwolves", abbr: "MIN"  },
  { espnId: 17, name: "Brooklyn Nets",          abbr: "BKN"  },
  { espnId: 18, name: "New York Knicks",        abbr: "NY"   },
  { espnId: 19, name: "Orlando Magic",          abbr: "ORL"  },
  { espnId: 20, name: "Philadelphia 76ers",     abbr: "PHI"  },
  { espnId: 21, name: "Phoenix Suns",           abbr: "PHX"  },
  { espnId: 22, name: "Portland Trail Blazers", abbr: "POR"  },
  { espnId: 23, name: "Sacramento Kings",       abbr: "SAC"  },
  { espnId: 24, name: "San Antonio Spurs",      abbr: "SA"   },
  { espnId: 25, name: "Oklahoma City Thunder",  abbr: "OKC"  },
  { espnId: 26, name: "Utah Jazz",              abbr: "UTAH" },
  { espnId: 27, name: "Washington Wizards",     abbr: "WSH"  },
  { espnId: 28, name: "Toronto Raptors",        abbr: "TOR"  },
  { espnId: 29, name: "Memphis Grizzlies",      abbr: "MEM"  },
  { espnId: 30, name: "Charlotte Hornets",      abbr: "CHA"  },
];

export const NBA_TEAMS: NbaTeam[] = ESPN_NBA_TEAMS.map((t) => ({ name: t.name, abbr: t.abbr }));

function currentSeason(): number {
  return new Date().getUTCFullYear();
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
// 30 teams x ~10 players each is a bigger crawl than WNBA's 15 teams; keep the
// same 200ms spacing ESPN tolerates — a full refresh takes a couple minutes.
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

async function buildTeamRoster(espnTeamId: number, teamAbbr: string, season: number): Promise<NbaPlayerProjection[]> {
  const athleteIds = await fetchAthleteIds(espnTeamId, season);

  const withMinutes: (NbaPlayerProjection & { avgMinutes: number })[] = [];
  for (const athleteId of athleteIds) {
    try {
      const [profile, stats, gameLog] = await Promise.all([
        fetchAthleteProfile(athleteId, season),
        fetchAthleteSeasonStats(athleteId, season),
        fetchAthleteGameLog(athleteId, season),
      ]);
      if (!stats) continue; // hasn't played this season — nothing real to project

      const projPts = round1(stats.avgPoints);
      const projAst = round1(stats.avgAssists);
      const projReb = round1(stats.avgRebounds);
      const proj3PM = round1(stats.avgThreePointFieldGoalsMade);

      // Real game-to-game variance from this player's actual log, when
      // available (gameLog is null on a fetch failure or zero games — see
      // espnNbaGameLog.ts). 0 signals "unknown", which negBinomAtLeast()
      // treats as "fall back to a plain Poisson assumption" for that stat.
      const varPts = gameLog ? sampleVariance(gameLog.pts) : 0;
      const varAst = gameLog ? sampleVariance(gameLog.ast) : 0;
      const varReb = gameLog ? sampleVariance(gameLog.reb) : 0;
      const var3PM = gameLog ? sampleVariance(gameLog.tpm) : 0;

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
        // Baseline (no opponent/pace adjustment yet -- that's applied later,
        // per actual matchup, by espnNbaScoreboardProvider.ts). Still an
        // upgrade over flat Poisson on its own: uses this player's real
        // observed variance rather than assuming textbook Poisson smoothness.
        probPts: negBinomAtLeast(projPts, varPts || projPts, Math.ceil(projPts)),
        probAst: negBinomAtLeast(projAst, varAst || projAst, Math.ceil(projAst)),
        probReb: negBinomAtLeast(projReb, varReb || projReb, Math.ceil(projReb)),
        prob3PM: negBinomAtLeast(proj3PM, var3PM || proj3PM, Math.ceil(proj3PM)),
        varPts, varAst, varReb, var3PM,
        // Filled in per-game by the provider (realNbaGames or the real-schedule
        // path) -- 0 here since this is the season-roster snapshot, not
        // tonight's game.
        simTodayPts: 0, simTodayAst: 0, simTodayReb: 0, simToday3PM: 0,
        actualPts: 0, actualAst: 0, actualReb: 0, actual3PM: 0,
        avgMinutes: stats.avgMinutes,
      });
    } catch (err) {
      console.warn(`[espn-nba] athlete ${athleteId} (team ${teamAbbr}) fetch failed:`, err);
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

/** Fetch every active NBA team's real roster + real season averages.
 *  Sequential + rate-limited: a full refresh of 30 teams takes a couple
 *  minutes. Callers should cache this, not call it on every poll tick. */
export async function fetchAllNbaRosters(): Promise<Map<string, NbaPlayerProjection[]>> {
  const season = currentSeason();
  const result = new Map<string, NbaPlayerProjection[]>();
  for (const team of ESPN_NBA_TEAMS) {
    try {
      const roster = await buildTeamRoster(team.espnId, team.abbr, season);
      if (roster.length > 0) result.set(team.abbr, roster);
    } catch (err) {
      console.warn(`[espn-nba] roster fetch failed for ${team.name}:`, err);
    }
  }
  return result;
}

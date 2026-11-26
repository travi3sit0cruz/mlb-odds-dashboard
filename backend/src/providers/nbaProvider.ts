/**
 * NBA game + player-projection provider.
 *
 * Rosters and season stat projections are REAL, pulled from ESPN's public
 * API via espnNbaClient.ts / espnNbaRosterCache.ts (see those files for the
 * ESPN host details and the ToS note — same technique the open-source
 * `hoopR` R package uses). Team names have always been real too.
 *
 * The one thing that is still synthetic: which two (real) teams play each
 * other "tonight" and the tip-off time. ESPN's documented, unauthenticated
 * NBA schedule endpoint (site.api's scoreboard) intermittently 403s from
 * this project's network — the same Akamai edge block that forced WNBA onto
 * a synthetic slate — so NBA follows the identical fallback: matchup pairing
 * generated deterministically per date (seeded) rather than pulled from a
 * real slate. Final scores for these fictional pairings are likewise a
 * synthetic estimate from the (real) roster's projected points, not a real
 * result — never treat `homeScore`/`awayScore` on this provider as a real
 * final score.
 */

import type { GameStatus, NbaGameRecord, NbaPlayerProjection } from "../types.js";
import { NBA_TEAMS } from "./espnNbaClient.js";
import { getNbaRosters } from "./espnNbaRosterCache.js";
import { elapsedFraction, syntheticLiveStat, syntheticLiveClock } from "../lib/syntheticLiveStats.js";
import { fetchRealNbaGames } from "./espnNbaScoreboardProvider.js";

// ─── Deterministic PRNG (seeded per date) — schedule pairing only ──────────

function makeRng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ─── Game generation ─────────────────────────────────────────────────────────

function statusForTipoff(gameDate: Date, now: Date): GameStatus {
  const diffMs = now.getTime() - gameDate.getTime();
  if (diffMs < 0) return "Preview";
  if (diffMs < 2.5 * 60 * 60 * 1000) return "Live"; // NBA games run ~2.5h
  return "Final";
}

function scoreFor(rng: () => number, roster: NbaPlayerProjection[]): number {
  // Team score is the sum of the full roster (starters plus bench) projected
  // points (real season averages), jittered. Still a synthetic estimate for
  // a synthetic matchup — see file header.
  const rosterTotal = roster.reduce((sum, p) => sum + p.projPts, 0);
  const jitter = (rng() - 0.5) * 12;
  return Math.max(75, Math.round(rosterTotal + jitter));
}

export async function realNbaGames(date: Date): Promise<NbaGameRecord[]> {
  const rosters = await getNbaRosters();
  // Only pair teams whose real roster actually loaded (skips any team ESPN
  // failed to fetch this cycle rather than showing an empty roster).
  const availableTeams = NBA_TEAMS.filter((t) => (rosters.get(t.abbr)?.length ?? 0) > 0);

  // Use a "sports day" boundary at 09:00 UTC (roughly 4-5am US Eastern)
  // instead of raw UTC midnight (roughly 7-8pm US Eastern). UTC midnight
  // falls right in the middle of a US evening slate, so the raw-UTC-date
  // version of this swapped today's games out for an entirely different
  // (different seed, different pairings) "tomorrow" schedule before
  // tonight's games even reached Final. Shifting the boundary into the
  // pre-dawn hours keeps one consistent slate for the whole evening.
  const sportsDay = new Date(date.getTime() - 9 * 60 * 60 * 1000);
  const dateStr = sportsDay.toISOString().slice(0, 10);
  const seed = dateStr.split("-").reduce((a, b) => a + parseInt(b, 10), 0) * 104729;
  const rng = makeRng(seed);
  const now = new Date();

  // Up to 8 games across the slate (NBA nights run busier than WNBA's),
  // tip-off times spread through the evening (UTC).
  const tipoffTimes = ["23:00", "23:30", "00:00", "00:30", "01:00", "01:30", "02:00", "02:30"];
  const usedTeams = new Set<number>();

  const games: NbaGameRecord[] = [];
  const slate = Math.min(8, Math.floor(availableTeams.length / 2));
  for (let i = 0; i < slate; i++) {
    let ai = Math.floor(rng() * availableTeams.length);
    let hi = Math.floor(rng() * availableTeams.length);
    let guard = 0;
    while ((ai === hi || usedTeams.has(ai) || usedTeams.has(hi)) && guard < 50) {
      ai = Math.floor(rng() * availableTeams.length);
      hi = Math.floor(rng() * availableTeams.length);
      guard++;
    }
    if (ai === hi) continue;
    usedTeams.add(ai);
    usedTeams.add(hi);

    const away = availableTeams[ai]!;
    const home = availableTeams[hi]!;
    const timeStr = tipoffTimes[i]!;
    // Times after midnight UTC belong to "tomorrow" relative to dateStr.
    const dayOffset = timeStr < "23:00" ? 1 : 0;
    const gameDateObj = new Date(`${dateStr}T00:00:00Z`);
    gameDateObj.setUTCDate(gameDateObj.getUTCDate() + dayOffset);
    const [hh, mm] = timeStr.split(":").map(Number);
    gameDateObj.setUTCHours(hh!, mm!, 0, 0);

    const status = statusForTipoff(gameDateObj, now);
    const gameId = `nba-${dateStr}-${i}`;
    const frac = elapsedFraction(gameDateObj.toISOString(), status, 2.5 * 60 * 60 * 1000);
    const liveClock = syntheticLiveClock(gameDateObj.toISOString(), status, 12);
    function withSimToday(p: NbaPlayerProjection): NbaPlayerProjection {
      const seedKey = `${gameId}:${p.id}`;
      return {
        ...p,
        simTodayPts: syntheticLiveStat(p.projPts, `${seedKey}:pts`, frac),
        simTodayAst: syntheticLiveStat(p.projAst, `${seedKey}:ast`, frac),
        simTodayReb: syntheticLiveStat(p.projReb, `${seedKey}:reb`, frac),
        simToday3PM: syntheticLiveStat(p.proj3PM, `${seedKey}:3pm`, frac),
      };
    }
    const homeRoster = (rosters.get(home.abbr) ?? []).map(withSimToday);
    const awayRoster = (rosters.get(away.abbr) ?? []).map(withSimToday);

    const game: NbaGameRecord = {
      gameId,
      gameDate: gameDateObj.toISOString(),
      status,
      isRealMatchup: false,
      liveClock,
      home,
      away,
      homeRoster,
      awayRoster,
      // Filled in by the NBA poller after merging live/mock odds by team name.
      lines: [],
      consensus: { homeWinPct: null, awayWinPct: null, prevHomeWinPct: null, prevAwayWinPct: null },
      statsSanityWarning: null,
      fetchedAt: now.toISOString(),
    };
    if (status !== "Preview") {
      game.homeScore = scoreFor(rng, homeRoster);
      game.awayScore = scoreFor(rng, awayRoster);
    }
    games.push(game);
  }

  return games.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
}

// ─── Provider class ───────────────────────────────────────────────────────────

export class NbaProvider {
  public readonly name: string;

  constructor() {
    this.name = "ESPN NBA (real teams/rosters/season stats; real schedule when ESPN's scoreboard is reachable, synthetic daily slate as fallback)";
  }

  /** Tries ESPN's real scoreboard first (real matchups, real scores, real
   *  box-score stats). Falls back to the synthetic daily slate if that
   *  fetch throws (network/HTTP failure) or comes back with zero games
   *  (an empty result from this endpoint has so far only ever meant an
   *  access problem, not a genuine no-games night, for an NBA regular
   *  season in progress) -- never leaves the dashboard empty. */
  async getGames(date?: Date): Promise<NbaGameRecord[]> {
    try {
      const real = await fetchRealNbaGames(date);
      if (real.length > 0) return real;
      console.warn("[nba] real scoreboard returned zero games, falling back to synthetic slate");
    } catch (err) {
      console.warn("[nba] real scoreboard fetch failed, falling back to synthetic slate:", err);
    }
    return realNbaGames(date ?? new Date());
  }
}

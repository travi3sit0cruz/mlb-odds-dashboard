/**
 * WNBA game + player-projection provider.
 *
 * Rosters and season stat projections are REAL, pulled from ESPN's public
 * API via espnWnbaClient.ts / espnWnbaRosterCache.ts (see those files for
 * the ESPN host details and the ToS note — same technique the open-source
 * `wehoop` R package uses). Team names have always been real too.
 *
 * The one thing that is still synthetic: which two (real) teams play each
 * other "tonight" and the tip-off time. There is no documented free public
 * schedule API for the WNBA (unlike MLB Stats API for baseball), so the
 * matchup pairing below is generated deterministically per date (seeded)
 * rather than pulled from a real slate. Final scores for these fictional
 * pairings are likewise a synthetic estimate from the (real) roster's
 * projected points, not a real result — never treat `homeScore`/`awayScore`
 * on this provider as a real final score.
 */

import type { GameStatus, WnbaGameRecord, WnbaPlayerProjection } from "../types.js";
import { WNBA_TEAMS } from "./espnWnbaClient.js";
import { getWnbaRosters } from "./espnWnbaRosterCache.js";
import { elapsedFraction, syntheticLiveStat, syntheticLiveClock } from "../lib/syntheticLiveStats.js";

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
  if (diffMs < 2.5 * 60 * 60 * 1000) return "Live"; // WNBA games run ~2h
  return "Final";
}

function scoreFor(rng: () => number, roster: WnbaPlayerProjection[]): number {
  // Team score is the sum of the full roster (starters plus bench) projected
  // points (now real season averages), jittered. Still a synthetic estimate
  // for a synthetic matchup — see file header.
  const rosterTotal = roster.reduce((sum, p) => sum + p.projPts, 0);
  const jitter = (rng() - 0.5) * 10;
  return Math.max(55, Math.round(rosterTotal + jitter));
}

export async function realWnbaGames(date: Date): Promise<WnbaGameRecord[]> {
  const rosters = await getWnbaRosters();
  // Only pair teams whose real roster actually loaded (skips any team ESPN
  // failed to fetch this cycle rather than showing an empty roster).
  const availableTeams = WNBA_TEAMS.filter((t) => (rosters.get(t.abbr)?.length ?? 0) > 0);

  // Use a "sports day" boundary at 09:00 UTC (roughly 4-5am US Eastern)
  // instead of raw UTC midnight (roughly 7-8pm US Eastern). UTC midnight
  // falls right in the middle of a US evening slate, so the raw-UTC-date
  // version of this swapped today's games out for an entirely different
  // (different seed, different pairings) "tomorrow" schedule before
  // tonight's games even reached Final. Shifting the boundary into the
  // pre-dawn hours keeps one consistent slate for the whole evening.
  const sportsDay = new Date(date.getTime() - 9 * 60 * 60 * 1000);
  const dateStr = sportsDay.toISOString().slice(0, 10);
  const seed = dateStr.split("-").reduce((a, b) => a + parseInt(b, 10), 0) * 7919;
  const rng = makeRng(seed);
  const now = new Date();

  // 5 games across the slate, tip-off times spread through the evening (UTC).
  const tipoffTimes = ["22:00", "23:00", "23:30", "00:00", "01:00"];
  const usedTeams = new Set<number>();

  const games: WnbaGameRecord[] = [];
  const slate = Math.min(5, Math.floor(availableTeams.length / 2));
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
    const dayOffset = timeStr < "22:00" ? 1 : 0;
    const gameDateObj = new Date(`${dateStr}T00:00:00Z`);
    gameDateObj.setUTCDate(gameDateObj.getUTCDate() + dayOffset);
    const [hh, mm] = timeStr.split(":").map(Number);
    gameDateObj.setUTCHours(hh!, mm!, 0, 0);

    const status = statusForTipoff(gameDateObj, now);
    const gameId = `wnba-${dateStr}-${i}`;
    const frac = elapsedFraction(gameDateObj.toISOString(), status, 2.5 * 60 * 60 * 1000);
    const liveClock = syntheticLiveClock(gameDateObj.toISOString(), status, 10);
    function withSimToday(p: WnbaPlayerProjection): WnbaPlayerProjection {
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

    const game: WnbaGameRecord = {
      gameId,
      gameDate: gameDateObj.toISOString(),
      status,
      liveClock,
      home,
      away,
      homeRoster,
      awayRoster,
      // Filled in by the WNBA poller after merging live/mock odds by team name.
      lines: [],
      consensus: { homeWinPct: null, awayWinPct: null, prevHomeWinPct: null, prevAwayWinPct: null },
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

export class WnbaProvider {
  public readonly name: string;

  constructor() {
    this.name = "ESPN WNBA (real teams/rosters/season stats; matchup pairing is a synthetic daily slate)";
  }

  async getGames(date: Date = new Date()): Promise<WnbaGameRecord[]> {
    return realWnbaGames(date);
  }
}

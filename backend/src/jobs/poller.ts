import type { BatterInfo, GameRecord, OddsProvider, OddsQuoteInput } from "../types.js";
import {
  fetchTodaysGames,
  fetchAllPitcherStats,
  fetchAllLineups,
} from "../providers/mlbStatsProvider.js";
import { consensusProbability, log5WinProbability } from "../lib/probability.js";
import { normalizeTeamName, buildBookLine } from "../lib/oddsMerge.js";
import type { GameCache } from "../db/cache.js";

// ─── Keep finished games visible for a while ──────────────────────────────────
//
// The MLB schedule endpoint is queried by calendar date, so a game that
// finishes right around midnight UTC would otherwise vanish the instant the
// poller rolls onto "today". We fetch yesterday + today every cycle, and once
// a game is first observed as "Final" we keep it in the list for 12 hours
// before dropping it. State lives in-memory for the life of the process.
const KEEP_FINAL_MS = 12 * 60 * 60 * 1000;
const finalizedAtByGamePk = new Map<number, number>();

function isWithinKeepWindow(gamePk: number, status: string, nowMs: number): boolean {
  if (status !== "Final") {
    finalizedAtByGamePk.delete(gamePk); // guard against a Final->Live correction
    return true;
  }
  const finalizedAt = finalizedAtByGamePk.get(gamePk) ?? nowMs;
  if (!finalizedAtByGamePk.has(gamePk)) finalizedAtByGamePk.set(gamePk, finalizedAt);
  return nowMs - finalizedAt <= KEEP_FINAL_MS;
}

function pruneFinalizedMap(nowMs: number): void {
  for (const [gamePk, finalizedAt] of finalizedAtByGamePk) {
    if (nowMs - finalizedAt > KEEP_FINAL_MS) finalizedAtByGamePk.delete(gamePk);
  }
}

export async function runPollCycle(oddsProvider: OddsProvider, cache: GameCache): Promise<number> {
  // Read last cycle's cache BEFORE overwriting it, so each book's line can be
  // compared against its own previous value for line-movement display. This
  // is lag-1 only (one cycle back), not a history table -- see BookLine's
  // prevHomeImpliedFair/prevAwayImpliedFair in types.ts for why.
  const prevByGamePk = new Map(cache.getAllGames().map((g) => [g.gamePk, g] as const));

  // Fetch schedule first, then pitchers + lineups + odds all in parallel.
  // Query yesterday + today so a game that finished just after midnight UTC
  // doesn't disappear the moment the calendar date rolls over.
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [todayGames, yesterdayGames] = await Promise.all([
    fetchTodaysGames(now),
    fetchTodaysGames(yesterday),
  ]);
  const byGamePk = new Map(
    [...yesterdayGames, ...todayGames].map((g) => [g.gamePk, g] as const),
  );
  const nowMs = now.getTime();
  pruneFinalizedMap(nowMs);
  const games = Array.from(byGamePk.values()).filter((g) =>
    isWithinKeepWindow(g.gamePk, g.status, nowMs),
  );

  const [pitcherMap, lineupMap, oddsQuotes] = await Promise.all([
    fetchAllPitcherStats(games).catch((err) => {
      console.error("[poller] pitcher stats failed:", err);
      return new Map();
    }),
    fetchAllLineups(games).catch((err) => {
      console.error("[poller] lineup fetch failed:", err);
      return new Map();
    }),
    oddsProvider.getMlbMoneylines().catch((err) => {
      console.error("[poller] odds provider failed:", err);
      return [] as OddsQuoteInput[];
    }),
  ]);

  const records: GameRecord[] = games.map((game) => {
    const homeKey = normalizeTeamName(game.home.name);
    const awayKey = normalizeTeamName(game.away.name);

    const matches    = oddsQuotes.filter(
      (q) => normalizeTeamName(q.homeTeamName) === homeKey &&
             normalizeTeamName(q.awayTeamName) === awayKey,
    );
    const prevLines = prevByGamePk.get(game.gamePk)?.lines;
    const prevFanduel    = prevLines?.find((l) => l.book === "FanDuel");
    const prevDraftkings = prevLines?.find((l) => l.book === "DraftKings");
    const fanduel    = buildBookLine("FanDuel",    matches.find((m) => m.book === "FanDuel"), prevFanduel);
    const draftkings = buildBookLine("DraftKings", matches.find((m) => m.book === "DraftKings"), prevDraftkings);

    const fairHomeProbs = [fanduel.homeImpliedFair, draftkings.homeImpliedFair]
      .filter((p): p is number => p !== null);
    const fairAwayProbs = [fanduel.awayImpliedFair, draftkings.awayImpliedFair]
      .filter((p): p is number => p !== null);
    const prevFairHomeProbs = [fanduel.prevHomeImpliedFair, draftkings.prevHomeImpliedFair]
      .filter((p): p is number => p !== null);
    const prevFairAwayProbs = [fanduel.prevAwayImpliedFair, draftkings.prevAwayImpliedFair]
      .filter((p): p is number => p !== null);

    const statModelHome =
      game.home.winPct !== undefined && game.away.winPct !== undefined
        ? log5WinProbability(game.home.winPct, game.away.winPct)
        : null;

    const homePitcher = game.homeProbablePitcherId
      ? (pitcherMap.get(game.homeProbablePitcherId) ?? null) : null;
    const awayPitcher = game.awayProbablePitcherId
      ? (pitcherMap.get(game.awayProbablePitcherId) ?? null) : null;

    const lineup      = lineupMap.get(game.gamePk)
      ?? { home: [] as BatterInfo[], away: [] as BatterInfo[], pitcherSO: new Map<number, number>() };
    const liveState = game.liveState && game.liveState.currentPitcher
      ? { ...game.liveState, currentPitcherSO: lineup.pitcherSO.get(game.liveState.currentPitcher.id) ?? null }
      : game.liveState;

    return {
      gamePk:     game.gamePk,
      gameDate:   game.gameDate,
      status:     game.status,
      liveState,
      home:       game.home,
      away:       game.away,
      homeScore:  game.homeScore,
      awayScore:  game.awayScore,
      homePitcher,
      awayPitcher,
      homeLineup: lineup.home,
      awayLineup: lineup.away,
      lines: [fanduel, draftkings],
      consensus: {
        homeWinPct: consensusProbability(fairHomeProbs),
        awayWinPct: consensusProbability(fairAwayProbs),
        prevHomeWinPct: consensusProbability(prevFairHomeProbs),
        prevAwayWinPct: consensusProbability(prevFairAwayProbs),
      },
      statModel: {
        homeWinPct: statModelHome,
        awayWinPct: statModelHome !== null ? 1 - statModelHome : null,
      },
      fetchedAt: new Date().toISOString(),
    };
  });

  cache.replaceAll(records);
  return records.length;
}

export function startPoller(oddsProvider: OddsProvider, cache: GameCache, intervalMs: number): () => void {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    try {
      const n = await runPollCycle(oddsProvider, cache);
      console.log(`[poller] refreshed ${n} games at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[poller] cycle failed:", err);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}

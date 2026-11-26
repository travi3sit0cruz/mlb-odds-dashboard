import type { NbaGameCache } from "../db/nbaCache.js";
import type { NbaProvider } from "../providers/nbaProvider.js";
import type { OddsProvider, OddsQuoteInput } from "../types.js";
import { linesForMatchup, consensusFromLines } from "../lib/oddsMerge.js";
import { checkMonotonic } from "../lib/statsSanity.js";

const NBA_MONOTONIC_FIELDS = [
  { key: "actualPts" as const, label: "PTS" },
  { key: "actualAst" as const, label: "AST" },
  { key: "actualReb" as const, label: "REB" },
  { key: "actual3PM" as const, label: "3PM" },
];

export async function runNbaPollCycle(
  provider: NbaProvider,
  oddsProvider: OddsProvider,
  cache: NbaGameCache,
): Promise<number> {
  // Lag-1 comparison, same approach as the MLB poller: read last cycle's
  // cache before overwriting it so each book's line can be diffed against
  // its own previous value.
  const prevByGameId = new Map(cache.getAllGames().map((g) => [g.gameId, g] as const));

  const [games, oddsQuotes] = await Promise.all([
    provider.getGames(),
    oddsProvider.getNbaMoneylines().catch((err) => {
      console.error("[nba-poller] odds provider failed:", err);
      return [] as OddsQuoteInput[];
    }),
  ]);

  const withOdds = games.map((game) => {
    const prevLines = prevByGameId.get(game.gameId)?.lines;
    const lines = linesForMatchup(oddsQuotes, game.home.name, game.away.name, prevLines);

    // Score-sum consistency check already ran in the provider (it needs
    // the FULL box score, not just the tracked starting five -- see
    // espnNbaScoreboardProvider.ts). Add the monotonic check here, where
    // the previous poll cycle's roster is available for comparison.
    let statsSanityWarning = game.statsSanityWarning;
    if (game.isRealMatchup && !statsSanityWarning) {
      const prevGame = prevByGameId.get(game.gameId);
      statsSanityWarning =
        checkMonotonic(prevGame?.isRealMatchup ? prevGame.homeRoster : undefined, game.homeRoster, NBA_MONOTONIC_FIELDS) ??
        checkMonotonic(prevGame?.isRealMatchup ? prevGame.awayRoster : undefined, game.awayRoster, NBA_MONOTONIC_FIELDS);
    }

    return { ...game, lines, consensus: consensusFromLines(lines), statsSanityWarning };
  });

  cache.replaceAll(withOdds);
  return withOdds.length;
}

export function startNbaPoller(
  provider: NbaProvider,
  oddsProvider: OddsProvider,
  cache: NbaGameCache,
  intervalMs: number,
): () => void {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    try {
      const n = await runNbaPollCycle(provider, oddsProvider, cache);
      console.log(`[nba-poller] refreshed ${n} games at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[nba-poller] cycle failed:", err);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}

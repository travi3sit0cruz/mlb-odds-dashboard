import type { WnbaGameCache } from "../db/wnbaCache.js";
import type { WnbaProvider } from "../providers/wnbaProvider.js";
import type { OddsProvider, OddsQuoteInput } from "../types.js";
import { linesForMatchup, consensusFromLines } from "../lib/oddsMerge.js";

export async function runWnbaPollCycle(
  provider: WnbaProvider,
  oddsProvider: OddsProvider,
  cache: WnbaGameCache,
): Promise<number> {
  // Lag-1 comparison, same approach as the MLB poller: read last cycle's
  // cache before overwriting it so each book's line can be diffed against
  // its own previous value.
  const prevByGameId = new Map(cache.getAllGames().map((g) => [g.gameId, g] as const));

  const [games, oddsQuotes] = await Promise.all([
    provider.getGames(),
    oddsProvider.getWnbaMoneylines().catch((err) => {
      console.error("[wnba-poller] odds provider failed:", err);
      return [] as OddsQuoteInput[];
    }),
  ]);

  const withOdds = games.map((game) => {
    const prevLines = prevByGameId.get(game.gameId)?.lines;
    const lines = linesForMatchup(oddsQuotes, game.home.name, game.away.name, prevLines);
    return { ...game, lines, consensus: consensusFromLines(lines) };
  });

  cache.replaceAll(withOdds);
  return withOdds.length;
}

export function startWnbaPoller(
  provider: WnbaProvider,
  oddsProvider: OddsProvider,
  cache: WnbaGameCache,
  intervalMs: number,
): () => void {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    try {
      const n = await runWnbaPollCycle(provider, oddsProvider, cache);
      console.log(`[wnba-poller] refreshed ${n} games at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[wnba-poller] cycle failed:", err);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}

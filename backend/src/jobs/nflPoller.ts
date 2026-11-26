import type { NflGameCache } from "../db/nflCache.js";
import type { OddsProvider, OddsQuoteInput } from "../types.js";
import { fetchNflGames } from "../providers/espnNflProvider.js";
import { linesForMatchup, consensusFromLines } from "../lib/oddsMerge.js";
import { checkMonotonic } from "../lib/statsSanity.js";

const NFL_MONOTONIC_FIELDS = [
  { key: "actualYds" as const, label: "Yds" },
  { key: "actualTD" as const, label: "TD" },
  { key: "actualRecOrAtt" as const, label: "Comp/Att/Rec" },
];

export async function runNflPollCycle(
  oddsProvider: OddsProvider,
  cache: NflGameCache,
): Promise<number> {
  // Lag-1 comparison, same approach as the MLB/WNBA pollers: read last
  // cycle's cache before overwriting it so each book's line can be diffed
  // against its own previous value.
  const prevByGameId = new Map(cache.getAllGames().map((g) => [g.gameId, g] as const));

  const [games, oddsQuotes] = await Promise.all([
    fetchNflGames(),
    oddsProvider.getNflMoneylines().catch((err) => {
      console.error("[nfl-poller] odds provider failed:", err);
      return [] as OddsQuoteInput[];
    }),
  ]);

  const withOdds = games.map((game) => {
    const prevLines = prevByGameId.get(game.gameId)?.lines;
    const lines = linesForMatchup(oddsQuotes, game.home.name, game.away.name, prevLines);

    // Internal consistency check against ESPN's own data -- see
    // lib/statsSanity.ts. No score-sum check for NFL (actualYds isn't the
    // stat that directly produces the score, unlike NBA's actualPts).
    const prevGame = prevByGameId.get(game.gameId);
    const statsSanityWarning =
      checkMonotonic(prevGame?.homeRoster, game.homeRoster, NFL_MONOTONIC_FIELDS) ??
      checkMonotonic(prevGame?.awayRoster, game.awayRoster, NFL_MONOTONIC_FIELDS);

    return { ...game, lines, consensus: consensusFromLines(lines), statsSanityWarning };
  });

  cache.replaceAll(withOdds);
  return withOdds.length;
}

export function startNflPoller(
  oddsProvider: OddsProvider,
  cache: NflGameCache,
  intervalMs: number,
): () => void {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    try {
      const n = await runNflPollCycle(oddsProvider, cache);
      console.log(`[nfl-poller] refreshed ${n} games at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[nfl-poller] cycle failed:", err);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}

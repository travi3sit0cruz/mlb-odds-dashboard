import type { IntlGameCache } from "../db/intlCache.js";
import type { IntlOddsProvider } from "../providers/intlOddsProvider.js";

export async function runIntlPollCycle(
  provider: IntlOddsProvider,
  cache: IntlGameCache,
): Promise<number> {
  // Lag-1 comparison, same approach as the MLB/WNBA pollers: read last
  // cycle's cache before overwriting it so this game's moneyline can be
  // diffed against its own previous value.
  const prevByGameId = new Map(cache.getAllGames().map((g) => [g.gameId, g] as const));

  const rawGames = await provider.getGames();
  const games = rawGames.map((game) => {
    if (!game.moneyline) return game;
    const prevMoneyline = prevByGameId.get(game.gameId)?.moneyline;
    return {
      ...game,
      moneyline: {
        ...game.moneyline,
        prevHomeFair: prevMoneyline?.homeFair ?? null,
        prevAwayFair: prevMoneyline?.awayFair ?? null,
      },
    };
  });

  cache.replaceAll(games);
  return games.length;
}

export function startIntlPoller(
  provider: IntlOddsProvider,
  cache: IntlGameCache,
  intervalMs: number,
): () => void {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    try {
      const n = await runIntlPollCycle(provider, cache);
      console.log(`[intl-poller] refreshed ${n} games at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[intl-poller] cycle failed:", err);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}

import type { OddsProvider } from "../types.js";
import { TheOddsApiProvider } from "./theOddsApiProvider.js";
import { MockOddsProvider } from "./mockOddsProvider.js";

/**
 * Provider factory. ODDS_PROVIDER env var selects the implementation.
 * Scraper fallback is intentionally NOT wired in here -- see README's
 * "Legal / ToS Considerations" section for why FanDuel/DraftKings scraping
 * is excluded from this codebase by design.
 */
export function createOddsProvider(env: Record<string, string | undefined>): OddsProvider {
  const selection = (env.ODDS_PROVIDER ?? "mock").toLowerCase();

  switch (selection) {
    case "theoddsapi":
      return new TheOddsApiProvider(env.THE_ODDS_API_KEY ?? "");
    case "mock":
      return new MockOddsProvider();
    default:
      throw new Error(`Unknown ODDS_PROVIDER "${selection}". Use "theoddsapi" or "mock".`);
  }
}

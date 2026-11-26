/**
 * The Odds API (the-odds-api.com) client.
 *
 * WHY THIS EXISTS: FanDuel and DraftKings do not offer public odds APIs, and
 * their Terms of Service prohibit automated scraping of odds data for
 * republishing (see README "Legal / ToS Considerations" section). The Odds
 * API licenses odds data directly from books (including FanDuel and
 * DraftKings) and re-serves it via a documented REST API, with a free tier
 * (500 requests/month at time of writing). This keeps the app fully
 * ToS-compliant while still surfacing FanDuel/DraftKings lines by name.
 *
 * Docs: https://the-odds-api.com/liveapi/guides/v4/
 * Endpoint used (per sport):
 *   GET https://api.the-odds-api.com/v4/sports/{sportKey}/odds
 *       ?apiKey=...&regions=us&markets=h2h&bookmakers=fanduel,draftkings
 * Sport keys: "baseball_mlb" (MLB), "basketball_wnba" (WNBA), "americanfootball_nfl" (NFL),
 *   "basketball_nba" (NBA).
 *
 * If you don't have a key yet, use ODDS_PROVIDER=mock in .env to run the
 * full app with synthetic (clearly-labeled, non-scraped) odds data.
 */

import type { AmericanOdds, OddsProvider, OddsQuoteInput } from "../types.js";

const SPORTS_BASE = "https://api.the-odds-api.com/v4/sports";

interface TheOddsApiEvent {
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: {
    key: string; // "fanduel" | "draftkings" | ...
    markets: {
      key: string; // "h2h"
      outcomes: { name: string; price: number }[];
    }[];
  }[];
}

const BOOK_KEY_MAP: Record<string, "FanDuel" | "DraftKings"> = {
  fanduel: "FanDuel",
  draftkings: "DraftKings",
};

export class TheOddsApiProvider implements OddsProvider {
  public readonly name = "TheOddsApi";

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error("THE_ODDS_API_KEY is required when ODDS_PROVIDER=theoddsapi");
    }
  }

  private async fetchMoneylines(sportKey: string): Promise<OddsQuoteInput[]> {
    const url = `${SPORTS_BASE}/${sportKey}/odds?apiKey=${this.apiKey}&regions=us&markets=h2h&bookmakers=fanduel,draftkings&oddsFormat=american`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`The Odds API request failed (${sportKey}): ${res.status} ${res.statusText}`);
    }
    const events = (await res.json()) as TheOddsApiEvent[];

    const quotes: OddsQuoteInput[] = [];

    for (const event of events) {
      for (const bookmaker of event.bookmakers) {
        const book = BOOK_KEY_MAP[bookmaker.key];
        if (!book) continue; // ignore any book other than FanDuel/DraftKings

        const h2h = bookmaker.markets.find((m) => m.key === "h2h");
        if (!h2h) continue;

        const homeOutcome = h2h.outcomes.find((o) => o.name === event.home_team);
        const awayOutcome = h2h.outcomes.find((o) => o.name === event.away_team);

        const homeOdds: AmericanOdds = homeOutcome ? homeOutcome.price : null;
        const awayOdds: AmericanOdds = awayOutcome ? awayOutcome.price : null;

        quotes.push({
          book,
          homeTeamName: event.home_team,
          awayTeamName: event.away_team,
          commenceTimeIso: event.commence_time,
          homeOdds,
          awayOdds,
        });
      }
    }

    return quotes;
  }

  async getMlbMoneylines(): Promise<OddsQuoteInput[]> {
    return this.fetchMoneylines("baseball_mlb");
  }

  async getWnbaMoneylines(): Promise<OddsQuoteInput[]> {
    return this.fetchMoneylines("basketball_wnba");
  }

  async getNflMoneylines(): Promise<OddsQuoteInput[]> {
    return this.fetchMoneylines("americanfootball_nfl");
  }

  async getNbaMoneylines(): Promise<OddsQuoteInput[]> {
    return this.fetchMoneylines("basketball_nba");
  }
}

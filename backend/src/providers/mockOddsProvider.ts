/**
 * Mock odds provider for local development when no licensed odds API key is
 * configured. Generates plausible-looking, RANDOMLY SEEDED moneylines for
 * whatever games are on today's MLB schedule. This is NOT scraped or real
 * market data -- it exists purely so the app is runnable end-to-end without
 * any paid subscription. Swap ODDS_PROVIDER=theoddsapi for real odds.
 */

import type { AmericanOdds, OddsProvider, OddsQuoteInput } from "../types.js";
import { fetchTodaysGames } from "./mlbStatsProvider.js";
import { realWnbaGames } from "./wnbaProvider.js";
import { fetchNflGames } from "./espnNflProvider.js";
import { realNbaGames } from "./nbaProvider.js";

function randomMoneylinePair(): { home: AmericanOdds; away: AmericanOdds } {
  // Pick a random favorite strength between -110 and -260, derive the dog side.
  const favoriteOdds = -(110 + Math.floor(Math.random() * 150));
  const favoriteImplied = -favoriteOdds / (-favoriteOdds + 100);
  // Add a small synthetic vig (~4%) then invert to underdog American odds.
  const dogImplied = 1 - favoriteImplied + 0.04;
  const dogOdds = Math.round((1 - dogImplied) > 0 ? (dogImplied / (1 - dogImplied)) * 100 : 100);
  const homeIsFavorite = Math.random() > 0.5;
  return homeIsFavorite
    ? { home: favoriteOdds, away: Math.max(dogOdds, 100) }
    : { home: Math.max(dogOdds, 100), away: favoriteOdds };
}

export class MockOddsProvider implements OddsProvider {
  public readonly name = "Mock (synthetic, non-scraped demo data)";

  async getMlbMoneylines(): Promise<OddsQuoteInput[]> {
    const games = await fetchTodaysGames();
    const quotes: OddsQuoteInput[] = [];

    for (const game of games) {
      for (const book of ["FanDuel", "DraftKings"] as const) {
        const { home, away } = randomMoneylinePair();
        quotes.push({
          book,
          homeTeamName: game.home.name,
          awayTeamName: game.away.name,
          commenceTimeIso: game.gameDate,
          homeOdds: home,
          awayOdds: away,
        });
      }
    }

    return quotes;
  }

  async getWnbaMoneylines(): Promise<OddsQuoteInput[]> {
    const games = await realWnbaGames(new Date());
    const quotes: OddsQuoteInput[] = [];

    for (const game of games) {
      for (const book of ["FanDuel", "DraftKings"] as const) {
        const { home, away } = randomMoneylinePair();
        quotes.push({
          book,
          homeTeamName: game.home.name,
          awayTeamName: game.away.name,
          commenceTimeIso: game.gameDate,
          homeOdds: home,
          awayOdds: away,
        });
      }
    }

    return quotes;
  }

  async getNflMoneylines(): Promise<OddsQuoteInput[]> {
    const games = await fetchNflGames();
    const quotes: OddsQuoteInput[] = [];

    for (const game of games) {
      for (const book of ["FanDuel", "DraftKings"] as const) {
        const { home, away } = randomMoneylinePair();
        quotes.push({
          book,
          homeTeamName: game.home.name,
          awayTeamName: game.away.name,
          commenceTimeIso: game.gameDate,
          homeOdds: home,
          awayOdds: away,
        });
      }
    }

    return quotes;
  }

  async getNbaMoneylines(): Promise<OddsQuoteInput[]> {
    const games = await realNbaGames(new Date());
    const quotes: OddsQuoteInput[] = [];

    for (const game of games) {
      for (const book of ["FanDuel", "DraftKings"] as const) {
        const { home, away } = randomMoneylinePair();
        quotes.push({
          book,
          homeTeamName: game.home.name,
          awayTeamName: game.away.name,
          commenceTimeIso: game.gameDate,
          homeOdds: home,
          awayOdds: away,
        });
      }
    }

    return quotes;
  }
}

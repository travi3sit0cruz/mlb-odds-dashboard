/**
 * Shared helpers for merging FanDuel/DraftKings moneyline quotes onto a game
 * record by team name. Used by both the MLB poller and the WNBA poller so
 * the matching + de-vig logic has one source of truth.
 */

import type { AmericanOdds, BookLine, OddsQuoteInput } from "../types.js";
import { devigMoneyline } from "./probability.js";

export function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").trim();
}

export function buildBookLine(
  book: "FanDuel" | "DraftKings",
  quote: OddsQuoteInput | undefined,
  /** This same book's line from the previous poll cycle, for line-movement display. */
  prevLine?: BookLine,
): BookLine {
  const prevHomeImpliedFair = prevLine?.homeImpliedFair ?? null;
  const prevAwayImpliedFair = prevLine?.awayImpliedFair ?? null;
  if (!quote || quote.homeOdds === null || quote.awayOdds === null) {
    return { book, homeOdds: quote?.homeOdds ?? null, awayOdds: quote?.awayOdds ?? null,
             homeImpliedRaw: null, awayImpliedRaw: null,
             homeImpliedFair: null, awayImpliedFair: null, lastUpdated: null,
             prevHomeImpliedFair, prevAwayImpliedFair };
  }
  const { homeRaw, awayRaw, homeFair, awayFair } = devigMoneyline(quote.homeOdds, quote.awayOdds);
  return { book, homeOdds: quote.homeOdds, awayOdds: quote.awayOdds,
           homeImpliedRaw: homeRaw, awayImpliedRaw: awayRaw,
           homeImpliedFair: homeFair, awayImpliedFair: awayFair,
           lastUpdated: new Date().toISOString(),
           prevHomeImpliedFair, prevAwayImpliedFair };
}

/** Find the FanDuel/DraftKings lines for a given matchup by normalized team name. */
export function linesForMatchup(
  quotes: OddsQuoteInput[],
  homeTeamName: string,
  awayTeamName: string,
  /** This same matchup's lines from the previous poll cycle, for line-movement display. */
  prevLines?: BookLine[],
): BookLine[] {
  const homeKey = normalizeTeamName(homeTeamName);
  const awayKey = normalizeTeamName(awayTeamName);
  const matches = quotes.filter(
    (q) => normalizeTeamName(q.homeTeamName) === homeKey &&
           normalizeTeamName(q.awayTeamName) === awayKey,
  );
  const prevFanduel = prevLines?.find((l) => l.book === "FanDuel");
  const prevDraftkings = prevLines?.find((l) => l.book === "DraftKings");
  return [
    buildBookLine("FanDuel", matches.find((m) => m.book === "FanDuel"), prevFanduel),
    buildBookLine("DraftKings", matches.find((m) => m.book === "DraftKings"), prevDraftkings),
  ];
}

/**
 * De-vigged consensus win% from a set of book lines (averages available fair
 * probs). prevHomeWinPct/prevAwayWinPct are the same average computed over
 * each line's prevHomeImpliedFair/prevAwayImpliedFair, so the consensus
 * movement is consistent with the per-book movement shown alongside it
 * (same books, same lag-1 cycle) rather than pulled from a separately
 * cached "previous consensus" value.
 */
export function consensusFromLines(lines: BookLine[]): {
  homeWinPct: number | null; awayWinPct: number | null;
  prevHomeWinPct: number | null; prevAwayWinPct: number | null;
} {
  const homeProbs = lines.map((l) => l.homeImpliedFair).filter((p): p is number => p !== null);
  const awayProbs = lines.map((l) => l.awayImpliedFair).filter((p): p is number => p !== null);
  const prevHomeProbs = lines.map((l) => l.prevHomeImpliedFair).filter((p): p is number => p !== null);
  const prevAwayProbs = lines.map((l) => l.prevAwayImpliedFair).filter((p): p is number => p !== null);
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  return {
    homeWinPct: avg(homeProbs), awayWinPct: avg(awayProbs),
    prevHomeWinPct: avg(prevHomeProbs), prevAwayWinPct: avg(prevAwayProbs),
  };
}

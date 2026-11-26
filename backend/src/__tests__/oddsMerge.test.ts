import { describe, expect, test } from "bun:test";
import { buildBookLine, consensusFromLines, linesForMatchup } from "../lib/oddsMerge.js";
import type { BookLine, OddsQuoteInput } from "../types.js";

describe("buildBookLine — line movement (prev* fields)", () => {
  test("no previous line => prev fields are null", () => {
    const line = buildBookLine("FanDuel", {
      book: "FanDuel", homeTeamName: "A", awayTeamName: "B",
      commenceTimeIso: "2026-01-01T00:00:00Z", homeOdds: -150, awayOdds: 130,
    });
    expect(line.prevHomeImpliedFair).toBeNull();
    expect(line.prevAwayImpliedFair).toBeNull();
  });

  test("carries forward the previous line's fair probabilities unchanged", () => {
    const prev: BookLine = buildBookLine("FanDuel", {
      book: "FanDuel", homeTeamName: "A", awayTeamName: "B",
      commenceTimeIso: "2026-01-01T00:00:00Z", homeOdds: -150, awayOdds: 130,
    });
    const current = buildBookLine("FanDuel", {
      book: "FanDuel", homeTeamName: "A", awayTeamName: "B",
      commenceTimeIso: "2026-01-01T00:00:00Z", homeOdds: -170, awayOdds: 150,
    }, prev);
    expect(current.prevHomeImpliedFair).toBeCloseTo(prev.homeImpliedFair!, 10);
    expect(current.prevAwayImpliedFair).toBeCloseTo(prev.awayImpliedFair!, 10);
    // the line itself moved: home got MORE favored (odds went from -150 to -170)
    expect(current.homeImpliedFair!).toBeGreaterThan(current.prevHomeImpliedFair!);
  });

  test("a book with no quote this cycle still reports its previous fair value", () => {
    const prev = buildBookLine("FanDuel", {
      book: "FanDuel", homeTeamName: "A", awayTeamName: "B",
      commenceTimeIso: "2026-01-01T00:00:00Z", homeOdds: -150, awayOdds: 130,
    });
    const current = buildBookLine("FanDuel", undefined, prev);
    expect(current.homeImpliedFair).toBeNull();
    expect(current.prevHomeImpliedFair).toBeCloseTo(prev.homeImpliedFair!, 10);
  });
});

describe("linesForMatchup — threads prev lines through by book", () => {
  test("matches each book's own previous line, not the other book's", () => {
    const prevLines: BookLine[] = [
      buildBookLine("FanDuel", { book: "FanDuel", homeTeamName: "A", awayTeamName: "B", commenceTimeIso: "t", homeOdds: -150, awayOdds: 130 }),
      buildBookLine("DraftKings", { book: "DraftKings", homeTeamName: "A", awayTeamName: "B", commenceTimeIso: "t", homeOdds: -140, awayOdds: 120 }),
    ];
    const quotes: OddsQuoteInput[] = [
      { book: "FanDuel", homeTeamName: "A", awayTeamName: "B", commenceTimeIso: "t2", homeOdds: -160, awayOdds: 140 },
      { book: "DraftKings", homeTeamName: "A", awayTeamName: "B", commenceTimeIso: "t2", homeOdds: -145, awayOdds: 125 },
    ];
    const [fanduel, draftkings] = linesForMatchup(quotes, "A", "B", prevLines) as [BookLine, BookLine];
    expect(fanduel.prevHomeImpliedFair).toBeCloseTo(prevLines[0]!.homeImpliedFair!, 10);
    expect(draftkings.prevHomeImpliedFair).toBeCloseTo(prevLines[1]!.homeImpliedFair!, 10);
    // cross-check they weren't swapped
    expect(fanduel.prevHomeImpliedFair).not.toBeCloseTo(prevLines[1]!.homeImpliedFair!, 3);
  });
});

describe("consensusFromLines — prev consensus averages each line's prev fair value", () => {
  test("averages prevHomeImpliedFair/prevAwayImpliedFair across books", () => {
    const prevLines: BookLine[] = [
      buildBookLine("FanDuel", { book: "FanDuel", homeTeamName: "A", awayTeamName: "B", commenceTimeIso: "t", homeOdds: -150, awayOdds: 130 }),
      buildBookLine("DraftKings", { book: "DraftKings", homeTeamName: "A", awayTeamName: "B", commenceTimeIso: "t", homeOdds: -140, awayOdds: 120 }),
    ];
    const lines = linesForMatchup(
      [
        { book: "FanDuel", homeTeamName: "A", awayTeamName: "B", commenceTimeIso: "t2", homeOdds: -160, awayOdds: 140 },
        { book: "DraftKings", homeTeamName: "A", awayTeamName: "B", commenceTimeIso: "t2", homeOdds: -145, awayOdds: 125 },
      ],
      "A", "B", prevLines,
    );
    const consensus = consensusFromLines(lines);
    const expectedPrevHome = (lines[0]!.prevHomeImpliedFair! + lines[1]!.prevHomeImpliedFair!) / 2;
    expect(consensus.prevHomeWinPct).toBeCloseTo(expectedPrevHome, 10);
    expect(consensus.homeWinPct).toBeGreaterThan(consensus.prevHomeWinPct!); // home got more favored
  });

  test("returns null prev consensus when there is no previous line at all", () => {
    const lines = linesForMatchup(
      [{ book: "FanDuel", homeTeamName: "A", awayTeamName: "B", commenceTimeIso: "t2", homeOdds: -160, awayOdds: 140 }],
      "A", "B",
    );
    const consensus = consensusFromLines(lines);
    expect(consensus.prevHomeWinPct).toBeNull();
    expect(consensus.prevAwayWinPct).toBeNull();
  });
});

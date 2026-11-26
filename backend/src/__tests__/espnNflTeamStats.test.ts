import { describe, expect, test } from "bun:test";
import { computeMatchupFactors, type NflTeamDefensePace } from "../providers/espnNflTeamStats.js";

function team(avgPointsAgainst: number, playsPerGame: number): NflTeamDefensePace {
  return { avgPointsAgainst, playsPerGame };
}

describe("computeMatchupFactors (NFL)", () => {
  test("returns null when a team isn't in the map yet", () => {
    const stats = new Map([["KC", team(20, 65)]]);
    expect(computeMatchupFactors("KC", "BUF", stats)).toBeNull();
  });

  test("returns null when the map is empty", () => {
    expect(computeMatchupFactors("KC", "BUF", new Map())).toBeNull();
  });

  test("league-average matchup (every team identical) yields factors of ~1", () => {
    const stats = new Map([
      ["KC", team(21, 65)],
      ["BUF", team(21, 65)],
      ["SF", team(21, 65)],
    ]);
    const result = computeMatchupFactors("KC", "BUF", stats)!;
    expect(result).not.toBeNull();
    expect(result.home.ydsTdFactor).toBeCloseTo(1, 5);
    expect(result.home.paceFactor).toBeCloseTo(1, 5);
    expect(result.away.ydsTdFactor).toBeCloseTo(1, 5);
    expect(result.away.paceFactor).toBeCloseTo(1, 5);
  });

  test("home player's ydsTdFactor is driven by the AWAY team's defense (weak away defense => boost)", () => {
    const stats = new Map([
      ["KC", team(20, 65)], // home: average-ish
      ["BUF", team(30, 65)], // away: lets up a lot of points (weak defense)
      ["SF", team(16, 65)], // keeps the league average sane
    ]);
    const result = computeMatchupFactors("KC", "BUF", stats)!;
    // KC (home) players face BUF's weak defense => ydsTdFactor > 1.
    expect(result.home.ydsTdFactor).toBeGreaterThan(1);
    // BUF (away) players face KC's tighter defense => ydsTdFactor < home's.
    expect(result.away.ydsTdFactor).toBeLessThan(result.home.ydsTdFactor);
  });

  test("pace factor is identical for both sides (property of the matchup, not one team)", () => {
    const stats = new Map([
      ["KC", team(20, 60)],
      ["BUF", team(22, 70)],
      ["SF", team(19, 64)],
    ]);
    const result = computeMatchupFactors("KC", "BUF", stats)!;
    expect(result.home.paceFactor).toBeCloseTo(result.away.paceFactor, 10);
  });

  test("extreme single-team outliers are clamped to [0.75, 1.3]", () => {
    const stats = new Map([
      ["KC", team(10, 45)], // extremely stingy defense + slow pace
      ["BUF", team(40, 90)], // extremely leaky defense + fast pace
      ["SF", team(21, 65)],
    ]);
    const result = computeMatchupFactors("KC", "BUF", stats)!;
    for (const side of [result.home, result.away]) {
      expect(side.ydsTdFactor).toBeGreaterThanOrEqual(0.75);
      expect(side.ydsTdFactor).toBeLessThanOrEqual(1.3);
      expect(side.paceFactor).toBeGreaterThanOrEqual(0.75);
      expect(side.paceFactor).toBeLessThanOrEqual(1.3);
    }
  });
});

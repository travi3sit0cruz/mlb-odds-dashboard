import { describe, expect, test } from "bun:test";
import { computeMatchupFactors, type NbaTeamDefensePace } from "../providers/espnNbaTeamStats.js";

function team(avgPointsAgainst: number, estimatedPossessions: number): NbaTeamDefensePace {
  return { avgPointsAgainst, estimatedPossessions };
}

describe("computeMatchupFactors", () => {
  test("returns null when a team isn't in the map yet", () => {
    const stats = new Map([["BOS", team(110, 100)]]);
    expect(computeMatchupFactors("BOS", "LAL", stats)).toBeNull();
  });

  test("returns null when the map is empty", () => {
    expect(computeMatchupFactors("BOS", "LAL", new Map())).toBeNull();
  });

  test("league-average matchup (every team identical) yields factors of ~1", () => {
    const stats = new Map([
      ["BOS", team(112, 100)],
      ["LAL", team(112, 100)],
      ["MIA", team(112, 100)],
    ]);
    const result = computeMatchupFactors("BOS", "LAL", stats)!;
    expect(result).not.toBeNull();
    expect(result.home.ptsFactor).toBeCloseTo(1, 5);
    expect(result.home.paceFactor).toBeCloseTo(1, 5);
    expect(result.away.ptsFactor).toBeCloseTo(1, 5);
    expect(result.away.paceFactor).toBeCloseTo(1, 5);
  });

  test("home player's ptsFactor is driven by the AWAY team's defense (weak away defense => boost)", () => {
    const stats = new Map([
      ["BOS", team(110, 100)], // home: average-ish
      ["LAL", team(130, 100)], // away: lets up a lot of points (weak defense)
      ["MIA", team(100, 100)], // keeps the league average sane
    ]);
    const result = computeMatchupFactors("BOS", "LAL", stats)!;
    // BOS (home) players face LAL's weak defense => ptsFactor > 1.
    expect(result.home.ptsFactor).toBeGreaterThan(1);
    // LAL (away) players face BOS's tighter defense => ptsFactor < home's.
    expect(result.away.ptsFactor).toBeLessThan(result.home.ptsFactor);
  });

  test("pace factor is identical for both sides (property of the matchup, not one team)", () => {
    const stats = new Map([
      ["BOS", team(110, 95)],
      ["LAL", team(115, 108)],
      ["MIA", team(108, 99)],
    ]);
    const result = computeMatchupFactors("BOS", "LAL", stats)!;
    expect(result.home.paceFactor).toBeCloseTo(result.away.paceFactor, 10);
  });

  test("extreme single-team outliers are clamped to [0.75, 1.3]", () => {
    const stats = new Map([
      ["BOS", team(80, 70)], // extremely stingy defense + slow pace
      ["LAL", team(160, 140)], // extremely leaky defense + fast pace
      ["MIA", team(112, 100)],
    ]);
    const result = computeMatchupFactors("BOS", "LAL", stats)!;
    for (const side of [result.home, result.away]) {
      expect(side.ptsFactor).toBeGreaterThanOrEqual(0.75);
      expect(side.ptsFactor).toBeLessThanOrEqual(1.3);
      expect(side.paceFactor).toBeGreaterThanOrEqual(0.75);
      expect(side.paceFactor).toBeLessThanOrEqual(1.3);
    }
  });
});

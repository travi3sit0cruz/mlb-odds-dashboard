import { describe, expect, test } from "bun:test";
import {
  americanOddsToImpliedProbability,
  removeVig,
  devigMoneyline,
  consensusProbability,
  log5WinProbability,
  poissonAtLeastOne,
  poissonAtLeast,
  sampleVariance,
  negBinomAtLeast,
} from "../lib/probability.js";

describe("americanOddsToImpliedProbability", () => {
  test("favorite (-150) => 0.6", () => {
    expect(americanOddsToImpliedProbability(-150)).toBeCloseTo(0.6, 5);
  });

  test("underdog (+150) => 0.4", () => {
    expect(americanOddsToImpliedProbability(150)).toBeCloseTo(0.4, 5);
  });

  test("even money (-100 and +100) both => 0.5", () => {
    expect(americanOddsToImpliedProbability(-100)).toBeCloseTo(0.5, 5);
    expect(americanOddsToImpliedProbability(100)).toBeCloseTo(0.5, 5);
  });

  test("throws on 0", () => {
    expect(() => americanOddsToImpliedProbability(0)).toThrow();
  });
});

describe("removeVig", () => {
  test("normalizes two raw probabilities that sum > 1 to sum exactly 1", () => {
    // -150/+130 book line: raw implieds are 0.6 and 0.4347826... (sum 1.0348, ~3.48% vig)
    const homeRaw = americanOddsToImpliedProbability(-150);
    const awayRaw = americanOddsToImpliedProbability(130);
    const result = removeVig(homeRaw, awayRaw);
    expect(result.homeFair + result.awayFair).toBeCloseTo(1, 10);
    expect(result.vig).toBeGreaterThan(0);
    expect(result.homeFair).toBeGreaterThan(result.awayFair);
  });
});

describe("devigMoneyline", () => {
  test("end-to-end: American odds pair -> fair probabilities summing to 1", () => {
    const result = devigMoneyline(-200, 175);
    expect(result.homeFair + result.awayFair).toBeCloseTo(1, 10);
    // -200 favorite should retain a clear edge over +175 dog after devig
    expect(result.homeFair).toBeGreaterThan(0.6);
  });
});

describe("consensusProbability", () => {
  test("averages multiple book probabilities", () => {
    expect(consensusProbability([0.6, 0.62])).toBeCloseTo(0.61, 5);
  });

  test("returns null for empty input", () => {
    expect(consensusProbability([])).toBeNull();
  });
});

describe("log5WinProbability", () => {
  test("equal win% teams => 0.5", () => {
    expect(log5WinProbability(0.5, 0.5)).toBeCloseTo(0.5, 5);
  });

  test("stronger home team => probability > 0.5", () => {
    expect(log5WinProbability(0.6, 0.4)).toBeGreaterThan(0.5);
  });

  test("is symmetric: log5(A,B) = 1 - log5(B,A)", () => {
    const p1 = log5WinProbability(0.58, 0.47);
    const p2 = log5WinProbability(0.47, 0.58);
    expect(p1 + p2).toBeCloseTo(1, 10);
  });
});

describe("poissonAtLeastOne", () => {
  test("lambda=0 => 0", () => {
    expect(poissonAtLeastOne(0)).toBe(0);
  });
  test("lambda=0.28 => ~24.4%", () => {
    expect(poissonAtLeastOne(0.28)).toBeCloseTo(0.2442, 3);
  });
  test("higher lambda => higher probability", () => {
    expect(poissonAtLeastOne(0.5)).toBeGreaterThan(poissonAtLeastOne(0.25));
  });
  test("very high lambda approaches 1", () => {
    expect(poissonAtLeastOne(10)).toBeCloseTo(1, 4);
  });
});

describe("poissonAtLeast", () => {
  test("k=1 matches poissonAtLeastOne", () => {
    expect(poissonAtLeast(0.28, 1)).toBeCloseTo(poissonAtLeastOne(0.28), 10);
  });
  test("k=0 => certain (1)", () => {
    expect(poissonAtLeast(5, 0)).toBe(1);
  });
  test("lambda=0, k>0 => 0", () => {
    expect(poissonAtLeast(0, 3)).toBe(0);
  });
  test("lambda=20, k=20 (meeting own average) is just above 50%", () => {
    // For integer lambda, P(X >= lambda) sits just above 50% (converging to
    // 0.5 from above as lambda grows) — a well-known Poisson property.
    const p = poissonAtLeast(20, 20);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.6);
  });
  test("higher k => lower probability", () => {
    expect(poissonAtLeast(15, 10)).toBeGreaterThan(poissonAtLeast(15, 20));
  });
});

describe("sampleVariance", () => {
  test("returns 0 for fewer than 2 values", () => {
    expect(sampleVariance([])).toBe(0);
    expect(sampleVariance([10])).toBe(0);
  });

  test("computes unbiased variance for a known small example", () => {
    // Values 2,4,4,4,5,5,7,9: mean=5, unbiased variance (n-1) = 32/7
    const values = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(sampleVariance(values)).toBeCloseTo(32 / 7, 10);
  });

  test("constant values => 0 variance", () => {
    expect(sampleVariance([6, 6, 6, 6])).toBeCloseTo(0, 10);
  });
});

describe("negBinomAtLeast", () => {
  test("k<=0 => certain (1)", () => {
    expect(negBinomAtLeast(10, 20, 0)).toBe(1);
    expect(negBinomAtLeast(10, 20, -1)).toBe(1);
  });

  test("mu<=0 => 0", () => {
    expect(negBinomAtLeast(0, 5, 3)).toBe(0);
  });

  test("falls back to poissonAtLeast when sigma2 <= mu (no overdispersion)", () => {
    expect(negBinomAtLeast(10, 10, 12)).toBeCloseTo(poissonAtLeast(10, 12), 10);
    expect(negBinomAtLeast(10, 5, 12)).toBeCloseTo(poissonAtLeast(10, 12), 10);
  });

  test("overdispersed (sigma2 > mu) gives a fatter tail than Poisson at the same mean", () => {
    // Real box-score stats are typically overdispersed: variance > mean.
    // The negative-binomial tail should sit above the Poisson tail for a
    // k meaningfully above the mean (fatter right tail = more "boom" games).
    const mu = 10;
    const sigma2 = 20; // overdispersed
    const nb = negBinomAtLeast(mu, sigma2, 15);
    const poisson = poissonAtLeast(mu, 15);
    expect(nb).toBeGreaterThan(poisson);
  });

  test("probability decreases as k increases", () => {
    const mu = 10;
    const sigma2 = 18;
    expect(negBinomAtLeast(mu, sigma2, 8)).toBeGreaterThan(negBinomAtLeast(mu, sigma2, 12));
  });

  test("result stays within [0, 1]", () => {
    const p = negBinomAtLeast(3, 50, 1);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});

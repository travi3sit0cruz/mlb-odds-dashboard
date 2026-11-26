/**
 * Transparent, testable odds math. No black boxes.
 *
 * American odds -> implied probability:
 *   Favorite (odds < 0):  P = -odds / (-odds + 100)
 *   Underdog (odds > 0):  P = 100 / (odds + 100)
 *
 * Vig removal (two-outcome market): given raw implied probabilities for both
 * sides of the SAME market (which sum to > 1.0 because of the book's hold),
 * normalize so they sum to exactly 1.0:
 *   fairP_A = rawP_A / (rawP_A + rawP_B)
 *   fairP_B = rawP_B / (rawP_A + rawP_B)
 */

export function americanOddsToImpliedProbability(odds: number): number {
  if (odds === 0) {
    throw new Error("American odds cannot be 0");
  }
  if (odds < 0) {
    return -odds / (-odds + 100);
  }
  return 100 / (odds + 100);
}

export interface DevigResult {
  homeFair: number;
  awayFair: number;
  /** The book's overround/hold, e.g. 0.045 = 4.5% vig */
  vig: number;
}

export function removeVig(homeRawProb: number, awayRawProb: number): DevigResult {
  const sum = homeRawProb + awayRawProb;
  if (sum <= 0) {
    throw new Error("Sum of raw probabilities must be positive");
  }
  return {
    homeFair: homeRawProb / sum,
    awayFair: awayRawProb / sum,
    vig: sum - 1,
  };
}

/**
 * Convenience: American odds pair for one market -> de-vigged fair probabilities.
 */
export function devigMoneyline(
  homeOdds: number,
  awayOdds: number,
): { homeRaw: number; awayRaw: number } & DevigResult {
  const homeRaw = americanOddsToImpliedProbability(homeOdds);
  const awayRaw = americanOddsToImpliedProbability(awayOdds);
  const { homeFair, awayFair, vig } = removeVig(homeRaw, awayRaw);
  return { homeRaw, awayRaw, homeFair, awayFair, vig };
}

/**
 * Consensus: simple average of de-vigged fair probabilities across N books.
 * (Equal-weighted by design for transparency; swap in weights here if desired.)
 */
export function consensusProbability(fairProbs: number[]): number | null {
  if (fairProbs.length === 0) return null;
  const sum = fairProbs.reduce((a, b) => a + b, 0);
  return sum / fairProbs.length;
}

/**
 * Baseline statistical model: Log5 (Bill James) using each team's season win%.
 * This is a simple sanity-check baseline, NOT a claim of superior predictive
 * power over the market. It ignores home-field advantage, pitching matchups,
 * injuries, etc. Treat as a starting point for future refinement.
 *
 *   P(home wins) = (pHome - pHome*pAway) / (pHome + pAway - 2*pHome*pAway)
 */
export function log5WinProbability(homeWinPct: number, awayWinPct: number): number {
  const clamp = (p: number) => Math.min(Math.max(p, 0.001), 0.999);
  const pH = clamp(homeWinPct);
  const pA = clamp(awayWinPct);
  const denom = pH + pA - 2 * pH * pA;
  if (denom === 0) return 0.5;
  return (pH - pH * pA) / denom;
}

/**
 * Poisson probability of achieving AT LEAST ONE occurrence in a game,
 * given a per-game average (lambda).
 *
 *   P(X >= 1) = 1 - P(X = 0) = 1 - e^(-lambda)
 *
 * Used for batter stat projections: if a player averages 0.28 hits/game,
 * the probability they get at least 1 hit tonight is 1 - e^(-0.28) = 24.4%.
 *
 * This is a transparent, mathematically standard approach used in DFS
 * modeling. It assumes independence across at-bats (a simplification —
 * pitcher matchup, park factor, etc. are not modeled here).
 */
export function poissonAtLeastOne(lambda: number): number {
  if (lambda <= 0) return 0;
  return 1 - Math.exp(-lambda);
}

/**
 * Poisson probability of achieving AT LEAST k occurrences in a game,
 * given a per-game average (lambda). Generalizes poissonAtLeastOne (k=1).
 *
 *   P(X >= k) = 1 - P(X < k) = 1 - sum_{i=0}^{k-1} pmf(i)
 *
 * pmf is computed via the stable multiplicative recurrence
 *   pmf(0) = e^(-lambda)
 *   pmf(i) = pmf(i-1) * lambda / i
 * which avoids factorial overflow for larger lambda/k (e.g. basketball
 * counting stats like points, where lambda can be 20+).
 *
 * Used for WNBA player projections: "probability of meeting or beating
 * tonight's own season-average projection." Since box-score stats are
 * integers and the projection (season avg) is usually fractional, "meeting
 * the projection" means reaching the next whole number at or above it, so
 * k = ceil(lambda). This is the same convention sportsbooks use for a prop
 * line set exactly at a player's average.
 */
export function poissonAtLeast(lambda: number, k: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  let pmf = Math.exp(-lambda); // pmf(0)
  let cdf = pmf;                // P(X <= 0)
  for (let i = 1; i <= k - 1; i++) {
    pmf *= lambda / i;
    cdf += pmf;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

/**
 * Unbiased sample variance (Bessel's correction, divide by n-1) of a real
 * list of per-game values. Returns 0 for fewer than 2 data points -- not
 * enough to say anything about variance yet, and 0 is the signal callers
 * use to fall back to a plain Poisson assumption (see negBinomAtLeast).
 */
export function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSq = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return sumSq / (values.length - 1);
}

/**
 * Negative-binomial survival probability P(X >= k), parametrized directly
 * by a target mean (mu) and variance (sigma2) rather than the classic r/p
 * form -- lets a caller plug in a player's own real game-log mean/variance
 * without hand-converting parameters.
 *
 * Real box-score counting stats (points, boards, etc.) are typically
 * "overdispersed" relative to Poisson -- a player's night-to-night variance
 * usually exceeds his own average (hot streaks, blowouts cutting minutes,
 * foul trouble), which a Poisson model (variance == mean, always) can't
 * represent. Negative-binomial adds one real degree of freedom to capture
 * that, while reducing to Poisson in the limit as overdispersion -> 0.
 *
 *   Standard negative-binomial, parametrized by (r, p):
 *     mean = r(1-p)/p,  variance = r(1-p)/p^2
 *   Solving for (r, p) given a target (mu, sigma2):
 *     p = mu / sigma2,   r = mu^2 / (sigma2 - mu)
 *   pmf(0) = p^r
 *   pmf(x) = pmf(x-1) * (1-p) * (r+x-1)/x      (same multiplicative-recurrence
 *                                                trick as poissonAtLeast, and
 *                                                works fine for non-integer r)
 *
 * Falls back to poissonAtLeast(mu, k) when sigma2 <= mu: that's "no real
 * overdispersion observed" (or too little game-log data to say -- callers
 * pass sigma2 = mu in that case), and r would blow up or go negative right
 * at/below that boundary.
 */
export function negBinomAtLeast(mu: number, sigma2: number, k: number): number {
  if (k <= 0) return 1;
  if (mu <= 0) return 0;
  if (sigma2 <= mu) return poissonAtLeast(mu, k);

  const r = (mu * mu) / (sigma2 - mu);
  const p = r / (r + mu);

  let pmf = Math.exp(r * Math.log(p)); // pmf(0) = p^r
  let cdf = pmf;
  for (let i = 1; i <= k - 1; i++) {
    pmf *= ((r + i - 1) / i) * (1 - p);
    cdf += pmf;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

/**
 * Synthetic "actual stat so far tonight" generator for sports whose matchup
 * schedule is itself synthetic (WNBA, NBA — see wnbaProvider.ts/nbaProvider.ts
 * for why there's no real public schedule API reachable here). There is no
 * real box score to pull for a fictional pairing, so these numbers are
 * explicitly fabricated — deterministic per player+game (stable across poll
 * refreshes, not re-randomized every tick) and scaled by how much of the
 * game's real-world clock has elapsed. NEVER present these as real stats;
 * callers must label them (UI uses a distinct "(sim)" badge color).
 *
 * Contrast with MLB/NFL, where the equivalent "actual" fields are always
 * real box-score data pulled from a live API.
 */

/** Deterministic pseudo-random unit value in [0, 1) from a string key. */
function unitFromString(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Fraction of the game's real-world clock elapsed, clamped to [0, 1].
 *  0 before tipoff/kickoff, 1 once the game is Final. */
export function elapsedFraction(gameDateIso: string, status: string, durationMs: number): number {
  if (status === "Preview" || status === "Unknown") return 0;
  if (status === "Final") return 1;
  const diffMs = Date.now() - new Date(gameDateIso).getTime();
  return Math.max(0, Math.min(1, diffMs / durationMs));
}

/** A synthetic "stat accumulated so far tonight" value: season-average
 *  projection * elapsed-time fraction * a per-player-per-game deterministic
 *  jitter (0.6x-1.4x), rounded to a whole counting stat. Stable across poll
 *  cycles (same seedKey => same jitter), grows smoothly as frac grows. */
export function syntheticLiveStat(proj: number, seedKey: string, frac: number): number {
  if (frac <= 0) return 0;
  const jitter = 0.6 + unitFromString(seedKey) * 0.8;
  return Math.round(proj * frac * jitter);
}

/** Synthetic "quarter + clock" estimate for a Live WNBA/NBA game, derived
 *  from wall-clock time elapsed since tipoff against a fixed-length
 *  per-period game clock. NOT a real play clock -- the matchup itself is a
 *  synthetic pairing (see elapsedFraction's doc above) -- so the UI always
 *  suffixes it "(est.)". Null unless the game is actually Live. */
export function syntheticLiveClock(gameDateIso: string, status: string, periodMinutes: number): string | null {
  if (status !== "Live") return null;
  const elapsedMin = (Date.now() - new Date(gameDateIso).getTime()) / 60000;
  const totalMin = periodMinutes * 4;
  const clamped = Math.max(0, Math.min(totalMin, elapsedMin));
  const period = Math.min(4, Math.floor(clamped / periodMinutes) + 1);
  const remaining = Math.max(0, periodMinutes - (clamped - (period - 1) * periodMinutes));
  const mm = Math.floor(remaining);
  const ss = Math.floor((remaining - mm) * 60);
  return `Q${period} \u00b7 ${mm}:${ss.toString().padStart(2, "0")} (est.)`;
}

/**
 * Internal consistency checks on ESPN's own real stats data.
 *
 * We don't have a second independent data source for NBA/NFL (NBA.com's
 * stats API and NFL.com have no usable free API -- see chat history), so
 * instead of cross-checking against another provider, this module flags
 * cases where ESPN's *own* numbers don't add up internally:
 *
 *   1. checkNbaScoreSum   -- a box score's summed player points should
 *      roughly equal the team's posted score. A mismatch beyond a small
 *      tolerance (garbage-time stat corrections, a stale partial pull)
 *      means something is off with this poll cycle's data.
 *   2. checkMonotonic     -- cumulative box-score stats (points, yards,
 *      touchdowns, etc.) can only go up during a live game. If a tracked
 *      field decreases between two poll cycles for the same player, that's
 *      either an ESPN correction/overturned play or a data glitch -- either
 *      way, worth flagging rather than silently trusting the new number.
 *
 * Both return a short human-readable warning string, or null when nothing
 * looks wrong (including "not enough data yet" cases like a box score with
 * no stats before tipoff -- that's normal, not a warning).
 */

/** Tolerance for the NBA score-sum check: team fouls/bonus free throws and
 *  ESPN's box score vs. final-score feeds can be off by a point or two even
 *  when both are correct, so only flag a gap bigger than this. */
const NBA_SCORE_SUM_TOLERANCE = 3;

/**
 * Compares a team's FULL box-score point total (every player who appears,
 * not just a subset like a starting five -- summing a subset under-counts
 * whenever a bench player scores, which is almost every real game) against
 * the team's posted score. Returns a warning if they differ by more than
 * `tolerance`, or null if:
 *   - boxscoreSum is 0 (box score not populated yet -- normal pregame)
 *   - postedScore is undefined (no score posted yet)
 *   - the two are within tolerance
 */
export function checkNbaScoreSum(
  boxscoreSum: number,
  postedScore: number | undefined,
  sideLabel: string,
  tolerance: number = NBA_SCORE_SUM_TOLERANCE,
): string | null {
  if (boxscoreSum === 0 || postedScore === undefined) return null;
  const diff = Math.abs(boxscoreSum - postedScore);
  if (diff <= tolerance) return null;
  return `${sideLabel}: box score sums to ${boxscoreSum} pts but posted score is ${postedScore} (off by ${diff})`;
}

/** One field to track for the monotonic check, e.g. { key: "actualPts", label: "PTS" }. */
export interface MonotonicField<T> {
  key: keyof T;
  label: string;
}

/**
 * Matches players between this poll cycle (`currRoster`) and the previous
 * one (`prevRoster`) by `id`, and flags any tracked numeric field that went
 * DOWN -- cumulative box-score stats should never decrease during a live
 * game. Returns the first such regression found (one warning per roster
 * per cycle is enough signal; this isn't meant to enumerate every player).
 * Returns null if there's no previous roster to compare against, or if
 * nothing regressed.
 */
export function checkMonotonic<T extends { id: string; name: string }>(
  prevRoster: T[] | undefined,
  currRoster: T[],
  fields: MonotonicField<T>[],
): string | null {
  if (!prevRoster || prevRoster.length === 0) return null;
  const prevById = new Map(prevRoster.map((p) => [p.id, p] as const));
  for (const curr of currRoster) {
    const prev = prevById.get(curr.id);
    if (!prev) continue;
    for (const field of fields) {
      const prevVal = prev[field.key];
      const currVal = curr[field.key];
      if (typeof prevVal !== "number" || typeof currVal !== "number") continue;
      if (currVal < prevVal) {
        return `${curr.name}: ${field.label} went from ${prevVal} to ${currVal} (decreased)`;
      }
    }
  }
  return null;
}

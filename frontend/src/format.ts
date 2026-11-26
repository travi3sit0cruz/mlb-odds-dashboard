export function formatOdds(odds: number | null): string {
  if (odds === null) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function formatPct(p: number | null): string {
  if (p === null) return "—";
  return `${(p * 100).toFixed(1)}%`;
}

export function formatStartTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** e.g. "Top 5th · 1-2, 1 out" — blank pieces omitted if data is missing. */
export function formatLiveState(ls: {
  inning: number | null;
  inningOrdinal: string | null;
  inningHalf: string | null;
  balls: number | null;
  strikes: number | null;
  outs: number | null;
} | null): string {
  if (!ls) return "";
  const inningPart = ls.inningHalf && ls.inningOrdinal
    ? `${ls.inningHalf} ${ls.inningOrdinal}`
    : ls.inning != null ? `Inning ${ls.inning}` : "";
  const countPart = ls.balls != null && ls.strikes != null ? `${ls.balls}-${ls.strikes}` : "";
  const outsPart = ls.outs != null ? `${ls.outs} out${ls.outs === 1 ? "" : "s"}` : "";
  return [inningPart, [countPart, outsPart].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
}

/** e.g. "P: Shaun Anderson (3 SO) · AB: Jackson Holliday" — omits a side if unknown. */
export function formatLiveMatchup(ls: {
  currentPitcher: { id: number; name: string } | null;
  currentBatter: { id: number; name: string } | null;
  currentPitcherSO: number | null;
} | null): string {
  if (!ls) return "";
  const parts: string[] = [];
  if (ls.currentPitcher) {
    const so = ls.currentPitcherSO != null ? ` (${ls.currentPitcherSO} SO)` : "";
    parts.push(`P: ${ls.currentPitcher.name}${so}`);
  }
  if (ls.currentBatter) parts.push(`AB: ${ls.currentBatter.name}`);
  return parts.join(" · ");
}

/**
 * Line movement since the previous poll cycle. Compares a fair probability
 * now vs its own prev* value (lag-1, from the backend's BookLine/consensus/
 * moneyline prev* fields -- see backend/src/types.ts for why it's one cycle
 * back and not a history table).
 *
 * Direction is phrased in probability terms ("this side got more/less
 * favored"), not raw odds sign, because American odds flip sign at even
 * money and a naive numeric diff on the odds themselves would misreport
 * direction right at that crossover. Fair probability has no such
 * discontinuity.
 *
 * A dead zone below 0.1 percentage points absorbs float noise from
 * de-vigging two independently-rounded odds on every poll, so a line that
 * hasn't actually moved never flickers an arrow.
 */
export type Movement = "up" | "down" | "none";

const MOVEMENT_DEAD_ZONE = 0.001; // 0.1 percentage point, in probability units (0-1)

export function movementOf(current: number | null, prev: number | null): Movement {
  if (current === null || prev === null) return "none";
  const delta = current - prev;
  if (Math.abs(delta) < MOVEMENT_DEAD_ZONE) return "none";
  return delta > 0 ? "up" : "down";
}

export function movementArrow(m: Movement): string {
  return m === "up" ? "\u25B2" : m === "down" ? "\u25BC" : "";
}

/** e.g. "+1.2 pts" / "-0.8 pts", or "" when there's nothing to show (no prev, or inside the dead zone). */
export function formatMovementDelta(current: number | null, prev: number | null): string {
  if (current === null || prev === null) return "";
  const deltaPts = (current - prev) * 100;
  if (Math.abs(deltaPts) < MOVEMENT_DEAD_ZONE * 100) return "";
  const sign = deltaPts > 0 ? "+" : "";
  return `${sign}${deltaPts.toFixed(1)}pt`;
}

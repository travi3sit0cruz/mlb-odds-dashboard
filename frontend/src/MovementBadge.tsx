import { formatMovementDelta, formatPct, movementArrow, movementOf } from "./format";

/**
 * Fair% plus a line-movement arrow/delta since the previous poll cycle.
 * Shared by GameCard, WnbaGameCard and IntlGameCard so the three tabs read
 * consistently. See format.ts's movementOf() for the dead-zone/why-lag-1
 * reasoning; this component only renders what that already decided.
 */
export function MovementBadge({ current, prev }: { current: number | null; prev: number | null }) {
  const m = movementOf(current, prev);
  const delta = formatMovementDelta(current, prev);
  return (
    <span className="movement-cell">
      <span className="movement-pct">{formatPct(current)}</span>
      {m !== "none" && (
        <span className={`movement-badge movement-badge--${m}`} title={`was ${formatPct(prev)} last refresh`}>
          {movementArrow(m)} {delta}
        </span>
      )}
    </span>
  );
}

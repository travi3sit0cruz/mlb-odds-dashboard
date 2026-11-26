import type { IntlGameRecord, RunLineGroup, TotalLine } from "./types";
import { formatOdds, formatPct, formatStartTime } from "./format";
import { MovementBadge } from "./MovementBadge";

// ─── helpers ──────────────────────────────────────────────────────────────────

function shortTeam(t: { name: string; abbr: string }) { return t.abbr; }

// ─── sub-components ───────────────────────────────────────────────────────────

function OddsCell({ odds }: { odds: number | null }) {
  if (odds === null) return <td className="odds-cell odds-cell--empty">—</td>;
  const fav = odds < 0;
  return <td className={`odds-cell ${fav ? "odds-fav" : "odds-dog"}`}>{formatOdds(odds)}</td>;
}

function RunLineRow({ rl, homeAbbr, awayAbbr, label }: {
  rl: RunLineGroup; homeAbbr: string; awayAbbr: string; label?: string;
}) {
  const homePoint = rl.homePoint >= 0 ? `+${rl.homePoint}` : `${rl.homePoint}`;
  const awayPoint = rl.homePoint <= 0 ? `+${-rl.homePoint}` : `${-rl.homePoint}`;
  return (
    <tr>
      <td className="rl-label">{label ?? "Run Line"}</td>
      <td className="rl-team">{homeAbbr} <span className="rl-point">{homePoint}</span></td>
      <OddsCell odds={rl.homeOdds} />
      <td className="rl-team">{awayAbbr} <span className="rl-point">{awayPoint}</span></td>
      <OddsCell odds={rl.awayOdds} />
    </tr>
  );
}

function TotalRow({ t, label }: { t: TotalLine; label?: string }) {
  return (
    <>
      <tr>
        <td className="rl-label">{label ?? `O/U ${t.line}`}</td>
        <td className="rl-team">Over</td>
        <OddsCell odds={t.overOdds} />
        <td className="rl-team">Under</td>
        <OddsCell odds={t.underOdds} />
      </tr>
      {(t.overFair !== null || t.underFair !== null) && (
        <tr className="fair-row">
          <td className="rl-label" />
          <td colSpan={2} className="fair-val">{formatPct(t.overFair)}</td>
          <td colSpan={2} className="fair-val">{formatPct(t.underFair)}</td>
        </tr>
      )}
    </>
  );
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function IntlGameCard({ game }: { game: IntlGameRecord }) {
  const inProgress = game.estimatedStatus === "Live";
  const isFinal    = game.estimatedStatus === "Final";

  return (
    <div className="game-card intl-card">

      {/* Header */}
      <div className="game-card-header">
        <div className="matchup">
          <span className="team">{game.away.name}</span>
          <span className="at">@</span>
          <span className="team">{game.home.name}</span>
        </div>
        <div className="status-col">
          <span className={`league-badge league-${game.league.toLowerCase()}`}>{game.league}</span>
          {/* (est.) suffix is deliberate: NPB/KBO have no real live/score feed,
              so this is only a time-based estimate, never real live state. */}
          <div className={`status status-${game.estimatedStatus.toLowerCase()}`}>
            {isFinal || inProgress
              ? `${game.estimatedStatus} (est.)`
              : formatStartTime(game.gameDate)}
          </div>
        </div>
      </div>

      {/* Moneyline */}
      {game.moneyline && (
        <section className="card-section">
          <div className="section-label">Moneyline</div>
          <table className="rl-table">
            <thead>
              <tr>
                <th />
                <th>{game.home.abbr} (Home)</th>
                <th>Odds</th>
                <th>{game.away.abbr} (Away)</th>
                <th>Odds</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="rl-label">ML</td>
                <td className="rl-team">{game.home.abbr}</td>
                <OddsCell odds={game.moneyline.homeOdds} />
                <td className="rl-team">{game.away.abbr}</td>
                <OddsCell odds={game.moneyline.awayOdds} />
              </tr>
              {game.moneyline.homeFair !== null && (
                <tr className="fair-row">
                  <td className="rl-label">Fair %</td>
                  <td colSpan={2} className="fair-val">
                    <MovementBadge current={game.moneyline.homeFair} prev={game.moneyline.prevHomeFair} />
                  </td>
                  <td colSpan={2} className="fair-val">
                    <MovementBadge current={game.moneyline.awayFair} prev={game.moneyline.prevAwayFair} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* Run lines (standard + alts) */}
      {(game.runLine || game.altRunLines.length > 0) && (
        <section className="card-section">
          <div className="section-label">Run Lines</div>
          <table className="rl-table">
            <thead>
              <tr>
                <th>Line</th>
                <th colSpan={2}>{game.home.abbr} (Home)</th>
                <th colSpan={2}>{game.away.abbr} (Away)</th>
              </tr>
            </thead>
            <tbody>
              {game.runLine && (
                <RunLineRow rl={game.runLine} homeAbbr={game.home.abbr} awayAbbr={game.away.abbr} label="±1.5" />
              )}
              {game.altRunLines.map((rl, i) => (
                <RunLineRow
                  key={i}
                  rl={rl}
                  homeAbbr={game.home.abbr}
                  awayAbbr={game.away.abbr}
                  label={`${rl.homePoint > 0 ? "+" : ""}${rl.homePoint} / ${rl.homePoint <= 0 ? "+" : ""}${-rl.homePoint}`}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Totals (standard + alts) */}
      {(game.total || game.altTotals.length > 0) && (
        <section className="card-section">
          <div className="section-label">Totals</div>
          <table className="rl-table">
            <tbody>
              {game.total && <TotalRow t={game.total} label={`O/U ${game.total.line} (std)`} />}
              {game.altTotals.map((t, i) => (
                <TotalRow key={i} t={t} label={`O/U ${t.line}`} />
              ))}
            </tbody>
          </table>
        </section>
      )}

    </div>
  );
}

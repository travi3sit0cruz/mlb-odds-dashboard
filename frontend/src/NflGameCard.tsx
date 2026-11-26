import type { NflGameRecord, NflPlayerProjection } from "./types";
import { formatStartTime, formatOdds } from "./format";
import { MovementBadge } from "./MovementBadge";

// ─── helpers ─────────────────────────────────────────────────────────────────

function shortName(full: string): string {
  const parts = full.trim().split(" ");
  if (parts.length < 2) return full;
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}
function fmtProb(n: number): string { return `${Math.round(n * 100)}%`; }

// ─── Roster table ─────────────────────────────────────────────────────────────
//
// Column semantics are position-dependent (QB's main number is pass yards,
// a WR's is receiving yards) -- each row carries its own labels, shown as
// a small caption under the number so the table stays legible at a glance.

function StatCell({ value, label, prob }: { value: number; label: string; prob: number }) {
  const pct = Math.round(prob * 100);
  const tier = pct >= 50 ? "prob-high" : pct >= 30 ? "prob-mid" : "prob-low";
  return (
    <td className="stat-cell">
      <span className="stat-proj">{value.toFixed(1)}</span>
      <span className="stat-sublabel">{label}</span>
      <span className={`stat-prob ${tier}`}>{fmtProb(prob)}</span>
    </td>
  );
}

function RosterRows({ players, side }: { players: NflPlayerProjection[]; side: "home" | "away" }) {
  return (
    <>
      {players.map((p) => {
        const hot = p.actualYds > 0 || p.actualTD > 0 || p.actualRecOrAtt > 0;
        return (
          <tr key={p.id} className={hot ? "batter-hot" : ""}>
            <td className={`bat-name bat-name--${side}`}>
              {shortName(p.name)}
              {hot && (
                <span className="today-line">
                  {p.actualYds} {p.ydsLabel.split(" ")[0]} Yds
                  {p.actualTD > 0 ? ` · ${p.actualTD} TD` : ""}
                  {p.actualRecOrAtt > 0 ? ` · ${p.actualRecOrAtt} ${p.thirdLabel}` : ""}
                </span>
              )}
            </td>
            <td className="bat-pos">{p.position}</td>
            <StatCell value={p.projYds} label={p.ydsLabel} prob={p.probYds} />
            <StatCell value={p.projTD} label={p.tdLabel} prob={p.probTD} />
            <StatCell value={p.projRecOrAtt} label={p.thirdLabel} prob={p.probRecOrAtt} />
          </tr>
        );
      })}
    </>
  );
}

function RosterTable({ roster, side }: { roster: NflPlayerProjection[]; side: "home" | "away" }) {
  if (roster.length === 0) {
    return <div className="lineup-not-posted">Roster not available</div>;
  }
  return (
    <table className="lineup-table wnba-table">
      <thead>
        <tr>
          <th>Player</th>
          <th>Pos</th>
          <th title="Season per-game average, position-dependent (pass/rush/rec yards)">Yds</th>
          <th title="Season per-game average touchdowns">TD</th>
          <th title="Completions (QB) / rush attempts (RB) / receptions (WR-TE)">Comp/Att/Rec</th>
        </tr>
        <tr className="subheader">
          <th colSpan={2} />
          <th colSpan={3}>avg/game · P(meets/beats avg tonight)</th>
        </tr>
      </thead>
      <tbody>
        <RosterRows players={roster} side={side} />
      </tbody>
    </table>
  );
}

// ─── Odds row ─────────────────────────────────────────────────────────────────

function BookRow({ game, book }: { game: NflGameRecord; book: "FanDuel" | "DraftKings" }) {
  const line = game.lines.find((l) => l.book === book);
  return (
    <tr>
      <td className="book-name">{book}</td>
      <td>{formatOdds(line?.homeOdds ?? null)}</td>
      <td>{formatOdds(line?.awayOdds ?? null)}</td>
      <td><MovementBadge current={line?.homeImpliedFair ?? null} prev={line?.prevHomeImpliedFair ?? null} /></td>
      <td><MovementBadge current={line?.awayImpliedFair ?? null} prev={line?.prevAwayImpliedFair ?? null} /></td>
    </tr>
  );
}

// ─── Full card ────────────────────────────────────────────────────────────────

export function NflGameCard({ game }: { game: NflGameRecord }) {
  const inProgress = game.status === "Live";
  const isFinal    = game.status === "Final";

  return (
    <div className="game-card">

      {/* Matchup header */}
      <div className="game-card-header">
        <div className="matchup">
          <span className="team">{game.away.name}</span>
          <span className="at">@</span>
          <span className="team">{game.home.name}</span>
        </div>
        <div className="status-col">
          {game.week !== null && <span className="league-badge">Wk {game.week}</span>}
          <div className={`status status-${game.status.toLowerCase()}`}>
            {isFinal || inProgress
              ? `${game.status}${game.awayScore !== undefined && game.homeScore !== undefined
                  ? ` — ${game.awayScore}-${game.homeScore}` : ""}`
              : formatStartTime(game.gameDate)}
          </div>
          {inProgress && game.liveClock && <div className="live-count">{game.liveClock}</div>}
          {game.statsSanityWarning && (
            <div className="sanity-warning" title={game.statsSanityWarning}>⚠ data check</div>
          )}
        </div>
      </div>

      {game.venue && <div className="section-note nfl-venue">{game.venue}</div>}

      {/* Skill-position player props */}
      <section className="card-section">
        <div className="section-label">
          Skill Players — Projected Stats
          <span className="section-note"> — avg/game · P(meets/beats avg tonight)</span>
        </div>
        <div className="lineups-row">
          <div className="lineup-side">
            <div className="side-tag side-tag--away">{game.away.name}</div>
            <RosterTable roster={game.awayRoster} side="away" />
          </div>
          <div className="lineup-divider" />
          <div className="lineup-side">
            <div className="side-tag side-tag--home">{game.home.name}</div>
            <RosterTable roster={game.homeRoster} side="home" />
          </div>
        </div>
      </section>

      {/* Moneyline odds */}
      <section className="card-section">
        <div className="section-label">Moneyline Odds</div>
        <table className="odds-table">
          <thead>
            <tr>
              <th>Book</th><th>Home ML</th><th>Away ML</th>
              <th>Home Fair%</th><th>Away Fair%</th>
            </tr>
          </thead>
          <tbody>
            <BookRow game={game} book="FanDuel" />
            <BookRow game={game} book="DraftKings" />
          </tbody>
        </table>
      </section>

      <div className="summary-row">
        <div className="summary-block">
          <span className="summary-label">Consensus (de-vigged avg)</span>
          <span className="summary-value">
            {game.home.name}&nbsp;<MovementBadge current={game.consensus.homeWinPct} prev={game.consensus.prevHomeWinPct} />&nbsp;|&nbsp;
            {game.away.name}&nbsp;<MovementBadge current={game.consensus.awayWinPct} prev={game.consensus.prevAwayWinPct} />
          </span>
        </div>
      </div>

    </div>
  );
}

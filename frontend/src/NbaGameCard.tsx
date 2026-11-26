import type { NbaGameRecord, NbaPlayerProjection } from "./types";
import { formatStartTime, formatOdds, formatPct } from "./format";
import { MovementBadge } from "./MovementBadge";

// ─── helpers ─────────────────────────────────────────────────────────────────

function shortName(full: string): string {
  const parts = full.trim().split(" ");
  if (parts.length < 2) return full;
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}
function fmtProj(n: number): string { return n.toFixed(1); }
function fmtProb(n: number): string { return `${Math.round(n * 100)}%`; }

// ─── Roster table ─────────────────────────────────────────────────────────────
//
// Each stat column shows: season avg/game (proj) · P(meets/beats that avg tonight)
// Probability uses Poisson model: P(X >= ceil(proj)) — see poissonAtLeast() in
// backend/src/lib/probability.ts for the full reasoning.

function StatCell({ proj, prob }: { proj: number; prob: number }) {
  const pct = Math.round(prob * 100);
  const tier = pct >= 50 ? "prob-high" : pct >= 30 ? "prob-mid" : "prob-low";
  return (
    <td className="stat-cell">
      <span className="stat-proj">{fmtProj(proj)}</span>
      <span className={`stat-prob ${tier}`}>{fmtProb(prob)}</span>
    </td>
  );
}

function RosterRows({ players, side }: { players: NbaPlayerProjection[]; side: "home" | "away" }) {
  return (
    <>
      {players.map((p) => {
        const hotReal = p.actualPts > 0 || p.actualAst > 0 || p.actualReb > 0 || p.actual3PM > 0;
        const hotSim  = !hotReal && (p.simTodayPts > 0 || p.simTodayAst > 0 || p.simTodayReb > 0 || p.simToday3PM > 0);
        const hot = hotReal || hotSim;
        return (
          <tr key={p.id} className={hot ? "batter-hot" : ""}>
            <td className={`bat-name bat-name--${side}`}>
              {shortName(p.name)}
              {hotReal && (
                <span className="today-line" title="Real box-score stats for tonight's actual game">
                  {[
                    p.actualPts  > 0 ? `${p.actualPts}PTS`  : null,
                    p.actualAst  > 0 ? `${p.actualAst}AST`  : null,
                    p.actualReb  > 0 ? `${p.actualReb}REB`  : null,
                    p.actual3PM  > 0 ? `${p.actual3PM}3PM`  : null,
                  ].filter(Boolean).join(" ")}
                </span>
              )}
              {hotSim && (
                <span className="today-line today-line--sim" title="Simulated -- matchup is a synthetic daily pairing, not a real game">
                  {[
                    p.simTodayPts  > 0 ? `${p.simTodayPts}PTS`  : null,
                    p.simTodayAst  > 0 ? `${p.simTodayAst}AST`  : null,
                    p.simTodayReb  > 0 ? `${p.simTodayReb}REB`  : null,
                    p.simToday3PM  > 0 ? `${p.simToday3PM}3PM`  : null,
                  ].filter(Boolean).join(" ")} (sim)
                </span>
              )}
            </td>
            <td className="bat-pos">{p.position}</td>
            <StatCell proj={p.projPts} prob={p.probPts} />
            <StatCell proj={p.projAst} prob={p.probAst} />
            <StatCell proj={p.projReb} prob={p.probReb} />
            <StatCell proj={p.proj3PM} prob={p.prob3PM} />
          </tr>
        );
      })}
    </>
  );
}

// Roster is split into two labeled groups so bench contributions are never
// mistaken for starting-five projections at a glance.
function RosterTable({ roster, side }: { roster: NbaPlayerProjection[]; side: "home" | "away" }) {
  if (roster.length === 0) {
    return <div className="lineup-not-posted">Roster not available</div>;
  }
  const starters = roster.filter((p) => p.role === "Starter");
  const bench = roster.filter((p) => p.role === "Bench");
  return (
    <table className="lineup-table nba-table">
      <thead>
        <tr>
          <th>Player</th>
          <th>Pos</th>
          <th title="Avg pts/game · P(meets/beats avg tonight)">PTS</th>
          <th title="Avg ast/game · P(meets/beats avg tonight)">AST</th>
          <th title="Avg reb/game · P(meets/beats avg tonight)">REB</th>
          <th title="Avg 3PM/game · P(meets/beats avg tonight)">3PM</th>
        </tr>
        <tr className="subheader">
          <th colSpan={2} />
          <th colSpan={4}>avg · prob</th>
        </tr>
      </thead>
      <tbody>
        {starters.length > 0 && (
          <tr className="roster-group-row">
            <td colSpan={6} className="roster-group-label roster-group-label--starter">Starters</td>
          </tr>
        )}
        <RosterRows players={starters} side={side} />
        {bench.length > 0 && (
          <tr className="roster-group-row">
            <td colSpan={6} className="roster-group-label roster-group-label--bench">Bench</td>
          </tr>
        )}
        <RosterRows players={bench} side={side} />
      </tbody>
    </table>
  );
}

// ─── Odds row ─────────────────────────────────────────────────────────────────

function BookRow({ game, book }: { game: NbaGameRecord; book: "FanDuel" | "DraftKings" }) {
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

export function NbaGameCard({ game }: { game: NbaGameRecord }) {
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

      {/* Rosters */}
      <section className="card-section">
        <div className="section-label">
          Roster — Projected Stats
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

      {/* Moneyline odds — licensed feed (The Odds API), FanDuel + DraftKings by name */}
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

import type { BatterInfo, GameRecord, PitcherInfo } from "./types";
import { formatLiveMatchup, formatLiveState, formatOdds, formatPct, formatStartTime } from "./format";
import { MovementBadge } from "./MovementBadge";

// ─── helpers ─────────────────────────────────────────────────────────────────

function shortName(full: string): string {
  const parts = full.trim().split(" ");
  if (parts.length < 2) return full;
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}
function shortTeam(name: string): string {
  return name.split(" ").pop() ?? name;
}
function fmtProj(n: number): string { return n.toFixed(2); }
function fmtProb(n: number): string { return `${Math.round(n * 100)}%`; }

// ─── Pitcher panel ───────────────────────────────────────────────────────────

function PitcherPanel({ pitcher, side }: { pitcher: PitcherInfo | null; side: "home" | "away" }) {
  if (!pitcher) {
    return (
      <div className="pitcher-panel">
        <div className="pitcher-name">TBD</div>
        <div className="pitcher-no-data">Not yet announced</div>
      </div>
    );
  }
  const starts = pitcher.recentStarts ?? [];
  return (
    <div className="pitcher-panel">
      <div className={`pitcher-name pitcher-name--${side}`}>
        {pitcher.name}
        {pitcher.projSO != null && (
          <span className="proj-so">Proj SO: {pitcher.projSO}</span>
        )}
      </div>
      {starts.length === 0 ? (
        <div className="pitcher-no-data">No start data available</div>
      ) : (
        <table className="pitcher-table">
          <thead>
            <tr>
              <th>Date</th><th>Opp</th><th>IP</th>
              <th>SO</th><th>H</th><th>ER</th><th>HR</th><th>Dec</th>
            </tr>
          </thead>
          <tbody>
            {starts.map((g, i) => (
              <tr key={i} className={g.decision === "W" ? "row-win" : g.decision === "L" ? "row-loss" : ""}>
                <td>{g.date.slice(5)}</td>
                <td className="opp-cell">{shortTeam(g.opponent)}</td>
                <td>{g.ip}</td>
                <td className="stat-so">{g.so}</td>
                <td>{g.h}</td>
                <td className={g.er >= 5 ? "stat-bad" : ""}>{g.er}</td>
                <td className={g.hr >= 2 ? "stat-bad" : ""}>{g.hr}</td>
                <td className={`dec dec-${g.decision.toLowerCase()}`}>{g.decision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Lineup table ─────────────────────────────────────────────────────────────
//
// Each stat column shows: season avg / game  (probability of ≥1 tonight)
// Probability uses Poisson model: P(X≥1) = 1 - e^(-lambda)
// where lambda = season avg per game. Clearly labeled in the table header.

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

function LineupTable({ batters, side }: { batters: BatterInfo[] | undefined; side: "home" | "away" }) {
  const rows = batters ?? [];
  if (rows.length === 0) {
    return <div className="lineup-not-posted">Lineup not yet posted</div>;
  }
  return (
    <table className="lineup-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Pos</th>
          <th title="Avg hits/game · P(≥1 hit tonight)">H</th>
          <th title="Avg runs/game · P(≥1 run tonight)">R</th>
          <th title="Avg HR/game · P(≥1 HR tonight)">HR</th>
          <th title="Avg RBI/game · P(≥1 RBI tonight)">RBI</th>
        </tr>
        <tr className="subheader">
          <th colSpan={3} />
          <th>avg · prob</th>
          <th>avg · prob</th>
          <th>avg · prob</th>
          <th>avg · prob</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => {
          const hot = b.todayH > 0 || b.todayR > 0 || b.todayHR > 0 || b.todayRBI > 0;
          return (
            <tr key={b.id} className={hot ? "batter-hot" : ""}>
              <td className="bat-order">{b.battingOrder}</td>
              <td className={`bat-name bat-name--${side}`}>
                {shortName(b.name)}
                {hot && (
                  <span className="today-line">
                    {[
                      b.todayH   > 0 ? `${b.todayH}H`     : null,
                      b.todayR   > 0 ? `${b.todayR}R`     : null,
                      b.todayHR  > 0 ? `${b.todayHR}HR`   : null,
                      b.todayRBI > 0 ? `${b.todayRBI}RBI` : null,
                    ].filter(Boolean).join(" ")}
                  </span>
                )}
              </td>
              <td className="bat-pos">{b.position}</td>
              <StatCell proj={b.projH}   prob={b.probH}   />
              <StatCell proj={b.projR}   prob={b.probR}   />
              <StatCell proj={b.projHR}  prob={b.probHR}  />
              <StatCell proj={b.projRBI} prob={b.probRBI} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Odds rows ────────────────────────────────────────────────────────────────

function BookRow({ game, book }: { game: GameRecord; book: "FanDuel" | "DraftKings" }) {
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

export function GameCard({ game }: { game: GameRecord }) {
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
          {inProgress && game.liveState && (
            <>
              <div className="live-count">{formatLiveState(game.liveState)}</div>
              <div className="live-matchup">{formatLiveMatchup(game.liveState)}</div>
            </>
          )}
        </div>
      </div>

      {/* Starting pitchers */}
      <section className="card-section">
        <div className="section-label">Starting Pitchers</div>
        <div className="pitchers-row">
          <div className="pitcher-side">
            <div className="side-tag side-tag--away">Away SP</div>
            <PitcherPanel pitcher={game.awayPitcher} side="away" />
          </div>
          <div className="pitcher-divider" />
          <div className="pitcher-side">
            <div className="side-tag side-tag--home">Home SP</div>
            <PitcherPanel pitcher={game.homePitcher} side="home" />
          </div>
        </div>
      </section>

      {/* Lineups */}
      <section className="card-section">
        <div className="section-label">
          Projected Lineup Stats
          <span className="section-note"> — avg/game · Poisson P(≥1 tonight)</span>
        </div>
        <div className="lineups-row">
          <div className="lineup-side">
            <div className="side-tag side-tag--away">{game.away.name}</div>
            <LineupTable batters={game.awayLineup ?? []} side="away" />
          </div>
          <div className="lineup-divider" />
          <div className="lineup-side">
            <div className="side-tag side-tag--home">{game.home.name}</div>
            <LineupTable batters={game.homeLineup ?? []} side="home" />
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

      {/* Consensus + model */}
      <div className="summary-row">
        <div className="summary-block">
          <span className="summary-label">Consensus (de-vigged avg)</span>
          <span className="summary-value">
            {game.home.name}&nbsp;<MovementBadge current={game.consensus.homeWinPct} prev={game.consensus.prevHomeWinPct} />&nbsp;|&nbsp;
            {game.away.name}&nbsp;<MovementBadge current={game.consensus.awayWinPct} prev={game.consensus.prevAwayWinPct} />
          </span>
        </div>
        <div className="summary-block">
          <span className="summary-label">Baseline stat model (Log5)</span>
          <span className="summary-value">
            {game.home.name} {formatPct(game.statModel.homeWinPct)}&nbsp;|&nbsp;
            {game.away.name} {formatPct(game.statModel.awayWinPct)}
          </span>
        </div>
      </div>

    </div>
  );
}

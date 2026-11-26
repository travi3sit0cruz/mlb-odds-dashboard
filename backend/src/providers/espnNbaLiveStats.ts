/**
 * Real, in-progress (or final) NBA box-score stats, pulled from ESPN's
 * `site.api.espn.com` game-summary endpoint -- one call per game returns
 * every player's full box score for both teams (unlike NFL's per-athlete
 * `sports.core.api.espn.com` crawl, basketball's per-athlete statistics/0
 * endpoint 404s, so this is the lighter-weight and more reliable path).
 *
 * Endpoint: GET https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={eventId}
 *   -> boxscore.players[] (one per team) -> statistics[0].labels (column
 *      order, e.g. ["MIN","PTS","FG","3PT",...]) + .athletes[].stats
 *      (same order; athlete.athlete.id is the ESPN athlete id).
 *
 * Only called for games whose status is Live or Final. Returns an empty
 * map on any failure -- never blocks the schedule/score data on this.
 */

const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";
const SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary";

export interface NbaLiveActual {
  pts: number;
  ast: number;
  reb: number;
  fg3m: number;
}

const ZERO: NbaLiveActual = { pts: 0, ast: 0, reb: 0, fg3m: 0 };

function parseMade(cell: string | undefined): number {
  // Shooting splits render as "made-attempted", e.g. "5-11".
  if (!cell) return 0;
  const made = cell.split("-")[0];
  const n = Number(made);
  return Number.isFinite(n) ? n : 0;
}

function parseCount(cell: string | undefined): number {
  const n = Number(cell);
  return Number.isFinite(n) ? n : 0;
}

export interface NbaBoxscoreResult {
  /** Every player's stats, keyed by ESPN athlete id. Players who didn't
   *  play (DNP) or aren't in the box score yet (pre-tipoff) are simply
   *  absent -- callers should treat a missing entry the same as ZERO. */
  playerStats: Map<string, NbaLiveActual>;
  /** Each team's points, summed across its FULL box score (every player
   *  who appears, not just the starting five this app tracks for
   *  projections) -- keyed by ESPN team id. This is what should be
   *  compared against the posted team score for a consistency check;
   *  summing only the tracked starters under-counts whenever a bench
   *  player scores, which is almost every real game. */
  teamTotals: Map<string, number>;
}

/** Fetch real box-score stats for every player in one game. Only called
 *  for games whose status is Live or Final. Returns empty results on any
 *  failure -- never blocks the schedule/score data on this. */
export async function fetchNbaBoxscore(eventId: string): Promise<NbaBoxscoreResult> {
  const playerStats = new Map<string, NbaLiveActual>();
  const teamTotals = new Map<string, number>();
  try {
    const res = await fetch(`${SUMMARY_URL}?event=${eventId}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return { playerStats, teamTotals };
    const data: any = await res.json();
    const teamBlocks: any[] = data.boxscore?.players ?? [];
    for (const block of teamBlocks) {
      const group = block.statistics?.[0];
      if (!group) continue;
      const teamId: string | undefined = block.team?.id;
      const labels: string[] = group.labels ?? [];
      const ptsIdx = labels.indexOf("PTS");
      const astIdx = labels.indexOf("AST");
      const rebIdx = labels.indexOf("REB");
      const fg3Idx = labels.indexOf("3PT");
      let teamSum = 0;
      for (const ath of group.athletes ?? []) {
        const id = ath.athlete?.id;
        const stats: string[] = ath.stats ?? [];
        if (!id || stats.length === 0) continue;
        const pts = ptsIdx >= 0 ? parseCount(stats[ptsIdx]) : 0;
        teamSum += pts;
        playerStats.set(id, {
          pts,
          ast: astIdx >= 0 ? parseCount(stats[astIdx]) : 0,
          reb: rebIdx >= 0 ? parseCount(stats[rebIdx]) : 0,
          fg3m: fg3Idx >= 0 ? parseMade(stats[fg3Idx]) : 0,
        });
      }
      if (teamId) teamTotals.set(teamId, teamSum);
    }
  } catch (err) {
    console.warn(`[espn-nba] boxscore fetch failed for event ${eventId}:`, err);
  }
  return { playerStats, teamTotals };
}

export { ZERO as NBA_LIVE_ZERO };

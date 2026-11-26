/**
 * Real per-game log for one NBA player this season, backed by ESPN's public
 * site.api.espn.com gamelog endpoint (a different host than espnNbaClient.ts's
 * sports.core.api.espn.com -- rate-limited separately below for that reason).
 *
 * Why this exists: espnNbaClient.ts's season-stats call only gives SEASON
 * AVERAGES. To model a player's real game-to-game volatility (see
 * negBinomAtLeast() in lib/probability.ts) we need the actual per-game
 * numbers, not just their average -- this is the only ESPN endpoint found
 * that exposes those.
 *
 * Note on host reliability: this project's other NBA/WNBA files warn that
 * site.api.espn.com intermittently 403s basketball paths from this network.
 * Spot-checked reliable for this specific gamelog path during development,
 * but callers must still degrade gracefully (return null, never throw) --
 * a player missing real variance data just falls back to a plain Poisson
 * assumption for that one player (see buildTeamRoster in espnNbaClient.ts),
 * never blocks the rest of the roster.
 */

const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";

// Separate rate limiter from espnNbaClient.ts's -- different host, so a
// shared clock would needlessly slow both down waiting on each other.
const MIN_SPACING_MS = 200;
let lastCallAt = 0;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PlayerGameLog {
  pts: number[];
  ast: number[];
  reb: number[];
  tpm: number[]; // three-pointers MADE (the gamelog's "3PT" column is "made-attempted")
}

/** Real per-game Regular Season log for one player, or null if unreachable /
 *  no regular-season games yet this season. Excludes preseason, play-in, and
 *  postseason on purpose -- those are different competitive contexts and
 *  would skew the variance of a player's regular-season production. */
export async function fetchAthleteGameLog(athleteId: string, season: number): Promise<PlayerGameLog | null> {
  const wait = MIN_SPACING_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();

  let data: any;
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athleteId}/gamelog?season=${season}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const labels: string[] = data.labels ?? [];
  const idxPts = labels.indexOf("PTS");
  const idxReb = labels.indexOf("REB");
  const idxAst = labels.indexOf("AST");
  const idxTpm = labels.indexOf("3PT");
  if (idxPts < 0 || idxReb < 0 || idxAst < 0 || idxTpm < 0) return null;

  // "Regular Season" only -- excludes "... Play In Regular Season" (a
  // different, much shorter slate) and postseason/preseason, which all
  // happen to contain the substring "Regular Season" or get listed as
  // separate seasonTypes entries ESPN's own UI keeps distinct.
  const seasonTypes: { displayName: string; categories: { events: { stats: string[] }[] }[] }[] =
    data.seasonTypes ?? [];
  const regularSeason = seasonTypes.find(
    (st) => st.displayName.endsWith("Regular Season") && !st.displayName.includes("Play In"),
  );
  if (!regularSeason) return null;

  const log: PlayerGameLog = { pts: [], ast: [], reb: [], tpm: [] };
  for (const category of regularSeason.categories) {
    for (const event of category.events ?? []) {
      const stats = event.stats;
      const pts = Number(stats[idxPts]);
      const reb = Number(stats[idxReb]);
      const ast = Number(stats[idxAst]);
      const tpmMade = Number((stats[idxTpm] ?? "0-0").split("-")[0]);
      if (!Number.isFinite(pts) || !Number.isFinite(reb) || !Number.isFinite(ast) || !Number.isFinite(tpmMade)) {
        continue; // a DNP or malformed row -- skip rather than poison the variance with a 0 that isn't real
      }
      log.pts.push(pts);
      log.reb.push(reb);
      log.ast.push(ast);
      log.tpm.push(tpmMade);
    }
  }
  return log.pts.length > 0 ? log : null;
}

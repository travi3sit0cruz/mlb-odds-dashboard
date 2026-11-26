/**
 * Real per-game log for one NFL player this season, backed by ESPN's public
 * site.api.espn.com gamelog endpoint (same host/approach as
 * espnNbaGameLog.ts).
 *
 * Why this exists: espnNflClient.ts's season-stats call only gives SEASON
 * TOTALS (divided into a per-game average downstream). To model a player's
 * real game-to-game volatility (see negBinomAtLeast() in lib/probability.ts)
 * we need the actual per-game numbers.
 *
 * Unlike NBA's gamelog (fixed column order for every player), NFL's
 * `labels` column order DEPENDS ON POSITION -- a QB's gamelog leads with
 * passing columns, a WR's leads with receiving columns, etc. `displayNames`
 * is the stable, position-independent way to find each real stat (e.g.
 * "Passing Yards" is always that string regardless of where it sits in the
 * array), so this file resolves indices from `displayNames`, not `labels`.
 *
 * Returns every stat kind (passing/rushing/receiving) regardless of
 * position -- the caller (espnNflClient.ts) already knows, per position,
 * which kind is the real "prop" stat for that player (same selection logic
 * it already uses for season stats).
 */

const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";

// Separate rate limiter from espnNflClient.ts's -- same host, but this file
// is only ever called alongside that one's own calls for the SAME athlete,
// never concurrently with a different athlete's call, so sharing a clock
// would just serialize work that's already sequential. Kept separate for
// the same reason espnNbaGameLog.ts's is: simplest to reason about alone.
const MIN_SPACING_MS = 150;
let lastCallAt = 0;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PlayerGameLog {
  passYds: number[];
  passTD: number[];
  completions: number[];
  rushYds: number[];
  rushTD: number[];
  rushAtt: number[];
  recYds: number[];
  recTD: number[];
  receptions: number[];
}

function emptyLog(): PlayerGameLog {
  return {
    passYds: [], passTD: [], completions: [],
    rushYds: [], rushTD: [], rushAtt: [],
    recYds: [], recTD: [], receptions: [],
  };
}

const WANTED: { key: keyof PlayerGameLog; displayName: string }[] = [
  { key: "passYds", displayName: "Passing Yards" },
  { key: "passTD", displayName: "Passing Touchdowns" },
  { key: "completions", displayName: "Completions" },
  { key: "rushYds", displayName: "Rushing Yards" },
  { key: "rushTD", displayName: "Rushing Touchdowns" },
  { key: "rushAtt", displayName: "Rushing Attempts" },
  { key: "recYds", displayName: "Receiving Yards" },
  { key: "recTD", displayName: "Receiving Touchdowns" },
  { key: "receptions", displayName: "Receptions" },
];

/** Real per-game Regular Season log for one player, or null if unreachable /
 *  no regular-season games yet this season. Excludes preseason/postseason
 *  on purpose, same reasoning as espnNbaGameLog.ts. */
export async function fetchAthleteGameLog(athleteId: string, season: number): Promise<PlayerGameLog | null> {
  const wait = MIN_SPACING_MS - (Date.now() - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();

  let data: any;
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${athleteId}/gamelog?season=${season}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const displayNames: string[] = data.displayNames ?? [];
  if (displayNames.length === 0) return null;

  const indices = WANTED.map((w) => ({ key: w.key, idx: displayNames.indexOf(w.displayName) }));

  const seasonTypes: { displayName: string; categories: { events: { stats: string[] }[] }[] }[] =
    data.seasonTypes ?? [];
  const regularSeason = seasonTypes.find(
    (st) => st.displayName.endsWith("Regular Season") && !st.displayName.includes("Play In"),
  );
  if (!regularSeason) return null;

  const log = emptyLog();
  let gamesSeen = 0;
  for (const category of regularSeason.categories) {
    for (const event of category.events ?? []) {
      const stats = event.stats;
      let anyFinite = false;
      for (const { key, idx } of indices) {
        if (idx < 0) continue; // this stat kind doesn't apply to this position's gamelog shape
        const value = Number(stats[idx]);
        if (Number.isFinite(value)) {
          log[key].push(value);
          anyFinite = true;
        }
      }
      if (anyFinite) gamesSeen++;
    }
  }
  return gamesSeen > 0 ? log : null;
}

/**
 * Real, in-progress NFL box-score stats for skill-position players, pulled
 * from ESPN's `sports.core.api.espn.com` host (the same host used for
 * WNBA/NBA rosters — unlike `site.api.espn.com`'s summary/boxscore endpoint,
 * this one has stayed reachable from this project's network).
 *
 * Only called for games whose status is "Live" (and only for the skill
 * players already on that game's cached roster — see espnNflRosterCache.ts),
 * to keep the per-poll-cycle call volume bounded: a typical live slate is a
 * handful of games x ~10-20 skill players x 2 teams, not a full 53-man roster.
 *
 * Endpoint per player:
 *   GET /v2/sports/football/leagues/nfl/events/{eventId}/competitions/{eventId}
 *       /competitors/{teamEspnId}/roster/{athleteId}/statistics/0
 */

const CORE_BASE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const UA = "Mozilla/5.0 (compatible; mlb-odds-dashboard/1.0)";

export interface NflLiveActual {
  passYds: number; passTD: number; completions: number;
  rushYds: number; rushTD: number; rushAtt: number;
  recYds: number; recTD: number; receptions: number;
}

const ZERO: NflLiveActual = {
  passYds: 0, passTD: 0, completions: 0,
  rushYds: 0, rushTD: 0, rushAtt: 0,
  recYds: 0, recTD: 0, receptions: 0,
};

// Modest bounded concurrency — this is a much smaller crawl than the
// season-roster refresh (only live games, only skill players), so it
// doesn't need the strict 200ms global spacing that one uses.
const CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchOnePlayerStats(eventId: string, teamEspnId: string, athleteId: string): Promise<NflLiveActual> {
  const url = `${CORE_BASE}/events/${eventId}/competitions/${eventId}/competitors/${teamEspnId}/roster/${athleteId}/statistics/0?lang=en&region=us`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) return ZERO;
    const data: any = await res.json();
    const categories: { name: string; stats: { name: string; value: number }[] }[] = data.splits?.categories ?? [];
    const byKey = new Map<string, number>();
    for (const cat of categories) {
      for (const stat of cat.stats) byKey.set(`${cat.name}.${stat.name}`, stat.value);
    }
    return {
      passYds: byKey.get("passing.passingYards") ?? 0,
      passTD: byKey.get("passing.passingTouchdowns") ?? 0,
      completions: byKey.get("passing.completions") ?? 0,
      rushYds: byKey.get("rushing.rushingYards") ?? 0,
      rushTD: byKey.get("rushing.rushingTouchdowns") ?? 0,
      rushAtt: byKey.get("rushing.rushingAttempts") ?? 0,
      recYds: byKey.get("receiving.receivingYards") ?? 0,
      recTD: byKey.get("receiving.receivingTouchdowns") ?? 0,
      receptions: byKey.get("receiving.receptions") ?? 0,
    };
  } catch {
    return ZERO;
  }
}

/** Fetch real in-game stats for a set of (teamEspnId, athleteId) pairs,
 *  keyed by athleteId. Failures degrade to zero per-player rather than
 *  failing the whole game. */
export async function fetchNflLiveStats(
  eventId: string,
  players: { teamEspnId: string; athleteId: string }[],
): Promise<Map<string, NflLiveActual>> {
  const results = await mapWithConcurrency(players, CONCURRENCY, (p) =>
    fetchOnePlayerStats(eventId, p.teamEspnId, p.athleteId).then((stats) => [p.athleteId, stats] as const),
  );
  return new Map(results);
}

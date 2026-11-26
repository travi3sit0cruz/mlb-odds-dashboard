/**
 * In-memory cache for real NBA team defense+pace stats (espnNbaTeamStats.ts).
 * Same stale-while-revalidate shape as espnNbaRosterCache.ts, just a much
 * shorter full-refresh time (2 calls/team vs ~2 calls/player) since there's
 * no per-player crawl involved.
 */

import type { NbaTeamDefensePace } from "./espnNbaTeamStats.js";
import { fetchAllNbaTeamStats } from "./espnNbaTeamStats.js";

const TTL_MS = 12 * 60 * 60 * 1000; // same cadence as rosters -- real season stats don't change intra-day

let cached: Map<string, NbaTeamDefensePace> | null = null;
let cachedAt = 0;
let refreshing: Promise<Map<string, NbaTeamDefensePace>> | null = null;

export async function getNbaTeamStats(): Promise<Map<string, NbaTeamDefensePace>> {
  const isStale = !cached || Date.now() - cachedAt >= TTL_MS;

  if (isStale && !refreshing) {
    refreshing = fetchAllNbaTeamStats()
      .then((result) => {
        // Same reasoning as the roster cache: a partial ESPN outage skips
        // teams individually rather than throwing, so don't let a too-small
        // result lock in as a 12h-good snapshot.
        if (result.size === 0) {
          console.warn(`[espn-nba] team-stats refresh came back empty, not caching -- will retry next call`);
          return cached ?? result;
        }
        cached = result;
        cachedAt = Date.now();
        return result;
      })
      .catch((err) => {
        console.error("[espn-nba] team-stats refresh failed, keeping previous cache:", err);
        return cached ?? new Map<string, NbaTeamDefensePace>();
      })
      .finally(() => {
        refreshing = null;
      });
  }

  if (cached) return cached;
  return refreshing!;
}

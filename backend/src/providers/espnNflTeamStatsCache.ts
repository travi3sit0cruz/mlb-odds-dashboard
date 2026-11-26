/**
 * In-memory cache for real NFL team defense+pace stats (espnNflTeamStats.ts).
 * Same stale-while-revalidate shape as espnNflRosterCache.ts.
 */

import type { NflTeamDefensePace } from "./espnNflTeamStats.js";
import { fetchAllNflTeamStats } from "./espnNflTeamStats.js";

const TTL_MS = 12 * 60 * 60 * 1000; // same cadence as rosters -- real season stats don't change intra-day

let cached: Map<string, NflTeamDefensePace> | null = null;
let cachedAt = 0;
let refreshing: Promise<Map<string, NflTeamDefensePace>> | null = null;

export async function getNflTeamStats(): Promise<Map<string, NflTeamDefensePace>> {
  const isStale = !cached || Date.now() - cachedAt >= TTL_MS;

  if (isStale && !refreshing) {
    refreshing = fetchAllNflTeamStats()
      .then((result) => {
        // Same reasoning as the roster cache: a partial ESPN outage skips
        // teams individually rather than throwing, so don't let a too-small
        // result lock in as a 12h-good snapshot.
        if (result.size === 0) {
          console.warn(`[espn-nfl] team-stats refresh came back empty, not caching -- will retry next call`);
          return cached ?? result;
        }
        cached = result;
        cachedAt = Date.now();
        return result;
      })
      .catch((err) => {
        console.error("[espn-nfl] team-stats refresh failed, keeping previous cache:", err);
        return cached ?? new Map<string, NflTeamDefensePace>();
      })
      .finally(() => {
        refreshing = null;
      });
  }

  if (cached) return cached;
  return refreshing!;
}

/**
 * In-memory cache for real NFL skill-position rosters fetched from ESPN
 * (espnNflClient.ts). Same stale-while-revalidate pattern as
 * espnWnbaRosterCache.ts: a full refresh is a few hundred rate-limited HTTP
 * calls (roughly a minute) — far too slow to redo on every poll tick — so
 * this serves the last-known-good snapshot immediately and only kicks off
 * a background refresh once it goes stale.
 */

import type { NflPlayerProjection } from "../types.js";
import { fetchAllNflRosters } from "./espnNflClient.js";

const TTL_MS = 12 * 60 * 60 * 1000; // real season stats/rosters don't change intra-day

let cached: Map<string, NflPlayerProjection[]> | null = null;
let cachedAt = 0;
let refreshing: Promise<Map<string, NflPlayerProjection[]>> | null = null;

export async function getNflRosters(): Promise<Map<string, NflPlayerProjection[]>> {
  const isStale = !cached || Date.now() - cachedAt >= TTL_MS;

  if (isStale && !refreshing) {
    refreshing = fetchAllNflRosters()
      .then((result) => {
        // A near-total ESPN outage during this window doesn't throw --
        // fetchAll* skips each failed team individually -- so an empty (or
        // too-small) result must NOT be committed as a 12h-good snapshot;
        // that would lock the whole slate empty until the TTL expires.
        // Keep serving the previous snapshot (if any) and retry next call.
        if (result.size === 0) {
          console.warn(`[espn-nfl] roster refresh came back empty, not caching -- will retry next call`);
          return cached ?? result;
        }
        cached = result;
        cachedAt = Date.now();
        return result;
      })
      .catch((err) => {
        console.error("[espn-nfl] roster refresh failed, keeping previous cache:", err);
        return cached ?? new Map<string, NflPlayerProjection[]>();
      })
      .finally(() => {
        refreshing = null;
      });
  }

  if (cached) return cached;
  return refreshing!;
}

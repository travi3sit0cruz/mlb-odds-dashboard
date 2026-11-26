/**
 * In-memory cache for real WNBA rosters fetched from ESPN (espnWnbaClient.ts).
 *
 * A full refresh is ~350 rate-limited HTTP calls (~1 minute) — far too slow
 * to redo on every WNBA poll tick (default 60s). This caches the result for
 * TTL_MS and serves the last-known-good snapshot immediately on every call;
 * a background refresh only kicks off once the snapshot goes stale, and the
 * old data keeps serving requests while that refresh is in flight.
 */

import type { WnbaPlayerProjection } from "../types.js";
import { fetchAllWnbaRosters } from "./espnWnbaClient.js";

const TTL_MS = 12 * 60 * 60 * 1000; // real season stats/rosters don't change intra-day

let cached: Map<string, WnbaPlayerProjection[]> | null = null;
let cachedAt = 0;
let refreshing: Promise<Map<string, WnbaPlayerProjection[]>> | null = null;

export async function getWnbaRosters(): Promise<Map<string, WnbaPlayerProjection[]>> {
  const isStale = !cached || Date.now() - cachedAt >= TTL_MS;

  if (isStale && !refreshing) {
    refreshing = fetchAllWnbaRosters()
      .then((result) => {
        // A near-total ESPN outage during this window doesn't throw --
        // fetchAll* skips each failed team individually -- so an empty (or
        // too-small) result must NOT be committed as a 12h-good snapshot;
        // that would lock the whole slate empty until the TTL expires.
        // Keep serving the previous snapshot (if any) and retry next call.
        if (result.size === 0) {
          console.warn(`[espn-wnba] roster refresh came back empty, not caching -- will retry next call`);
          return cached ?? result;
        }
        cached = result;
        cachedAt = Date.now();
        return result;
      })
      .catch((err) => {
        console.error("[espn-wnba] roster refresh failed, keeping previous cache:", err);
        return cached ?? new Map<string, WnbaPlayerProjection[]>();
      })
      .finally(() => {
        refreshing = null;
      });
  }

  // Serve whatever we already have immediately (stale-while-revalidate).
  // Only block the caller on the very first-ever fetch, when there's nothing cached yet.
  if (cached) return cached;
  return refreshing!;
}

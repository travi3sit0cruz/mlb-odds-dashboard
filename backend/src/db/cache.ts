/**
 * SQLite cache for computed GameRecords. Uses Bun's built-in `bun:sqlite`
 * (no native compilation needed). Backend always serves from this cache;
 * the poller writes to it on a schedule. Clients never wait on an upstream
 * API call.
 *
 * Each poll cycle fetches the FULL current slate of games and replaces the
 * table contents entirely (delete + insert in one transaction). This is
 * intentional: it guarantees the cache never contains stale rows from a
 * previous day or an older schema version (e.g. games cached before the
 * pitcher/lineup fields existed), which would otherwise cause the frontend
 * to read `undefined` on fields that didn't exist yet.
 */

import { Database } from "bun:sqlite";
import type { GameRecord } from "../types.js";

export class GameCache {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.run(`
      CREATE TABLE IF NOT EXISTS games (
        gamePk INTEGER PRIMARY KEY,
        payload TEXT NOT NULL,
        fetchedAt TEXT NOT NULL
      )
    `);
  }

  /** Replace the entire cache with the latest fetched slate of games. */
  replaceAll(games: GameRecord[]): void {
    const del = this.db.prepare(`DELETE FROM games`);
    const ins = this.db.prepare(`INSERT INTO games (gamePk, payload, fetchedAt) VALUES (?, ?, ?)`);
    const tx = this.db.transaction((rows: GameRecord[]) => {
      del.run();
      for (const g of rows) {
        ins.run(g.gamePk, JSON.stringify(g), g.fetchedAt);
      }
    });
    tx(games);
  }

  getAllGames(): GameRecord[] {
    const rows = this.db.query(`SELECT payload FROM games`).all() as {
      payload: string;
    }[];
    const games = rows.map((r) => JSON.parse(r.payload) as GameRecord);
    // Order by scheduled start time, earliest first.
    return games.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
  }

  close(): void {
    this.db.close();
  }
}

/**
 * SQLite cache for NflGameRecords.
 * Shares the same DB file as the other caches but uses its own table.
 */

import { Database } from "bun:sqlite";
import type { NflGameRecord } from "../types.js";

export class NflGameCache {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.run(`
      CREATE TABLE IF NOT EXISTS nfl_games (
        gameId TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        fetchedAt TEXT NOT NULL
      )
    `);
  }

  replaceAll(games: NflGameRecord[]): void {
    const del = this.db.prepare(`DELETE FROM nfl_games`);
    const ins = this.db.prepare(`INSERT INTO nfl_games (gameId, payload, fetchedAt) VALUES (?, ?, ?)`);
    const tx = this.db.transaction((rows: NflGameRecord[]) => {
      del.run();
      for (const g of rows) ins.run(g.gameId, JSON.stringify(g), g.fetchedAt);
    });
    tx(games);
  }

  getAllGames(): NflGameRecord[] {
    const rows = this.db.query(`SELECT payload FROM nfl_games`).all() as { payload: string }[];
    return rows
      .map((r) => JSON.parse(r.payload) as NflGameRecord)
      .sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
  }

  close(): void { this.db.close(); }
}

/**
 * SQLite cache for WnbaGameRecords.
 * Shares the same DB file as GameCache/IntlGameCache but uses its own table.
 */

import { Database } from "bun:sqlite";
import type { WnbaGameRecord } from "../types.js";

export class WnbaGameCache {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.run(`
      CREATE TABLE IF NOT EXISTS wnba_games (
        gameId TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        fetchedAt TEXT NOT NULL
      )
    `);
  }

  replaceAll(games: WnbaGameRecord[]): void {
    const del = this.db.prepare(`DELETE FROM wnba_games`);
    const ins = this.db.prepare(`INSERT INTO wnba_games (gameId, payload, fetchedAt) VALUES (?, ?, ?)`);
    const tx = this.db.transaction((rows: WnbaGameRecord[]) => {
      del.run();
      for (const g of rows) ins.run(g.gameId, JSON.stringify(g), g.fetchedAt);
    });
    tx(games);
  }

  getAllGames(): WnbaGameRecord[] {
    const rows = this.db.query(`SELECT payload FROM wnba_games`).all() as { payload: string }[];
    return rows
      .map((r) => JSON.parse(r.payload) as WnbaGameRecord)
      .sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
  }

  close(): void { this.db.close(); }
}

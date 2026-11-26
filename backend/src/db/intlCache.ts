/**
 * SQLite cache for IntlGameRecords (NPB + KBO).
 * Shares the same DB file as GameCache but uses a separate table.
 */

import { Database } from "bun:sqlite";
import type { IntlGameRecord } from "../types.js";

export class IntlGameCache {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.run(`
      CREATE TABLE IF NOT EXISTS intl_games (
        gameId TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        fetchedAt TEXT NOT NULL
      )
    `);
  }

  replaceAll(games: IntlGameRecord[]): void {
    const del = this.db.prepare(`DELETE FROM intl_games`);
    const ins = this.db.prepare(`INSERT INTO intl_games (gameId, payload, fetchedAt) VALUES (?, ?, ?)`);
    const tx = this.db.transaction((rows: IntlGameRecord[]) => {
      del.run();
      for (const g of rows) ins.run(g.gameId, JSON.stringify(g), g.fetchedAt);
    });
    tx(games);
  }

  getAllGames(): IntlGameRecord[] {
    const rows = this.db.query(`SELECT payload FROM intl_games`).all() as { payload: string }[];
    return rows
      .map((r) => JSON.parse(r.payload) as IntlGameRecord)
      .sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
  }

  close(): void { this.db.close(); }
}

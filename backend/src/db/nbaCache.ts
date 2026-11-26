/**
 * SQLite cache for NbaGameRecords.
 * Shares the same DB file as GameCache/IntlGameCache/WnbaGameCache/NflGameCache
 * but uses its own table.
 */

import { Database } from "bun:sqlite";
import type { NbaGameRecord } from "../types.js";

export class NbaGameCache {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.run(`
      CREATE TABLE IF NOT EXISTS nba_games (
        gameId TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        fetchedAt TEXT NOT NULL
      )
    `);
  }

  replaceAll(games: NbaGameRecord[]): void {
    const del = this.db.prepare(`DELETE FROM nba_games`);
    const ins = this.db.prepare(`INSERT INTO nba_games (gameId, payload, fetchedAt) VALUES (?, ?, ?)`);
    const tx = this.db.transaction((rows: NbaGameRecord[]) => {
      del.run();
      for (const g of rows) ins.run(g.gameId, JSON.stringify(g), g.fetchedAt);
    });
    tx(games);
  }

  getAllGames(): NbaGameRecord[] {
    const rows = this.db.query(`SELECT payload FROM nba_games`).all() as { payload: string }[];
    return rows
      .map((r) => JSON.parse(r.payload) as NbaGameRecord)
      .sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
  }

  close(): void { this.db.close(); }
}

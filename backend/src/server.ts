import "dotenv/config";
import express from "express";
import cors from "cors";
import { join } from "path";
import { existsSync } from "fs";
import { createOddsProvider } from "./providers/index.js";
import { GameCache } from "./db/cache.js";
import { IntlGameCache } from "./db/intlCache.js";
import { startPoller } from "./jobs/poller.js";
import { IntlOddsProvider } from "./providers/intlOddsProvider.js";
import { startIntlPoller } from "./jobs/intlPoller.js";
import { WnbaProvider } from "./providers/wnbaProvider.js";
import { WnbaGameCache } from "./db/wnbaCache.js";
import { startWnbaPoller } from "./jobs/wnbaPoller.js";
import { NflGameCache } from "./db/nflCache.js";
import { startNflPoller } from "./jobs/nflPoller.js";
import { NbaProvider } from "./providers/nbaProvider.js";
import { NbaGameCache } from "./db/nbaCache.js";
import { startNbaPoller } from "./jobs/nbaPoller.js";

const PORT = Number(process.env.PORT ?? 4000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);
const DB_PATH = process.env.DB_PATH ?? "./data/cache.sqlite";

// Frontend static files are expected at ../frontend/dist (built by `bun run build`
// in the frontend folder, or by the root-level `bun run start` script).
const FRONTEND_DIST = join(import.meta.dir, "..", "..", "frontend", "dist");
const servingStatic = existsSync(FRONTEND_DIST);

const oddsProvider = createOddsProvider(process.env);
const cache = new GameCache(DB_PATH);
const stopPoller = startPoller(oddsProvider, cache, POLL_INTERVAL_MS);

const intlApiKey = process.env.ODDS_PROVIDER === "theoddsapi" ? (process.env.THE_ODDS_API_KEY ?? null) : null;
const intlProvider = new IntlOddsProvider(intlApiKey);
const intlCache = new IntlGameCache(DB_PATH);
const stopIntlPoller = startIntlPoller(intlProvider, intlCache, POLL_INTERVAL_MS);

const wnbaProvider = new WnbaProvider();
const wnbaCache = new WnbaGameCache(DB_PATH);
const stopWnbaPoller = startWnbaPoller(wnbaProvider, oddsProvider, wnbaCache, POLL_INTERVAL_MS);

const nflProviderName = `ESPN NFL (real teams/schedule/scores) + ${oddsProvider.name} odds`;
const nflCache = new NflGameCache(DB_PATH);
const stopNflPoller = startNflPoller(oddsProvider, nflCache, POLL_INTERVAL_MS);

const nbaProvider = new NbaProvider();
const nbaCache = new NbaGameCache(DB_PATH);
const stopNbaPoller = startNbaPoller(nbaProvider, oddsProvider, nbaCache, POLL_INTERVAL_MS);

const app = express();

// FRONTEND_ORIGIN locks CORS to the deployed frontend's origin in production.
// Left unset, default to the Vite dev server origin so `bun run dev` on both
// sides works out of the box even if the frontend talks to the backend
// cross-origin (VITE_API_BASE_URL set to an absolute URL) instead of through
// Vite's same-origin proxy.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
app.use(cors({ origin: FRONTEND_ORIGIN }));

// API routes — always available
app.get("/api/games", (_req, res) => {
  res.json({
    provider: oddsProvider.name,
    games: cache.getAllGames(),
  });
});

app.get("/api/intl-games", (_req, res) => {
  res.json({
    provider: intlProvider.name,
    games: intlCache.getAllGames(),
  });
});

app.get("/api/wnba-games", (_req, res) => {
  res.json({
    provider: wnbaProvider.name,
    games: wnbaCache.getAllGames(),
  });
});

app.get("/api/nfl-games", (_req, res) => {
  res.json({
    provider: nflProviderName,
    games: nflCache.getAllGames(),
  });
});

app.get("/api/nba-games", (_req, res) => {
  res.json({
    provider: nbaProvider.name,
    games: nbaCache.getAllGames(),
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", oddsProvider: oddsProvider.name });
});

// Serve the built React app as static files so the whole dashboard is on one
// port. If dist/ hasn't been built yet, API-only mode still works fine.
if (servingStatic) {
  app.use(express.static(FRONTEND_DIST));
  // For client-side routing: serve index.html for any non-API route
  app.get("*", (_req, res) => {
    res.sendFile(join(FRONTEND_DIST, "index.html"));
  });
} else {
  console.warn(
    `[server] frontend/dist not found — API-only mode. Run 'bun run build' in the frontend folder to enable the dashboard UI.`,
  );
}

const server = app.listen(PORT, () => {
  console.log(`\nMLB Odds Dashboard → http://localhost:${PORT}`);
  if (servingStatic) {
    console.log(`Dashboard UI: http://localhost:${PORT}`);
  }
  console.log(`Odds provider: ${oddsProvider.name}\n`);
});

function shutdown() {
  console.log("Shutting down...");
  stopPoller();
  stopIntlPoller();
  stopWnbaPoller();
  stopNflPoller();
  stopNbaPoller();
  cache.close();
  intlCache.close();
  wnbaCache.close();
  nflCache.close();
  nbaCache.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

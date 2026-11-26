# MLB Odds Dashboard

Real-time MLB matchup dashboard combining live game data from the **MLB Stats
API** with moneyline odds from **FanDuel** and **DraftKings**, showing
de-vigged implied win probabilities and a consensus estimate per team.

---

## 1. Architecture Overview

```
┌───────────────┐      ┌───────────────────────────┐      ┌────────────────┐
│ MLB Stats API │─────▶│                             │      │                │
│ (free, live)  │      │  Backend (Node.js + Bun/TS) │─────▶│  React SPA     │
└───────────────┘      │  - poller (60s interval)    │      │  Dashboard     │
┌───────────────┐      │  - devig + consensus math    │◀────│  (polls every  │
│ Odds provider │─────▶│  - SQLite cache              │      │  30s)          │
│ (see §5)      │      │  - REST: GET /api/games       │      └────────────────┘
└───────────────┘      └───────────────────────────┘
```

- A background **poller** refreshes data on a fixed interval and writes to a
  SQLite cache. The API layer only ever reads from cache, so client requests
  are always fast and never blocked on an upstream call or rate limit.
- The frontend is a plain polling SPA (30s interval) — sufficient since odds
  don't move fast enough to justify a WebSocket for v1. Documented as a
  future upgrade path.

---

## 2. Tech Stack & Dependencies

**Backend** (`/backend`): Bun runtime (Node-compatible) + TypeScript,
Express, `bun:sqlite` (built into Bun, no native compilation needed),
`dotenv`, `cors`. Tests via `bun test`.

**Frontend** (`/frontend`): React 18 + TypeScript, Vite, plain CSS.

Why Bun instead of plain Node: identical TypeScript/Express code, but you
get a built-in SQLite driver (`bun:sqlite`) and test runner with zero extra
native dependencies — this matters a lot for Windows dev machines where
`better-sqlite3`/`node-gyp` builds are a common source of pain. If you'd
rather run on plain Node in production, swap `bun:sqlite` for
`better-sqlite3` (same API shape) and `bun test` for `vitest`; everything
else is unchanged.

---

## 3. Backend Code

See `/backend/src`:
- `providers/mlbStatsProvider.ts` — MLB Stats API client (game data)
- `providers/theOddsApiProvider.ts` — licensed odds client (default real-data path)
- `providers/mockOddsProvider.ts` — synthetic odds for local dev without an API key
- `lib/probability.ts` — American odds → implied probability, vig removal, consensus, Log5 baseline (fully unit tested, see `src/__tests__/probability.test.ts`)
- `jobs/poller.ts` — orchestrates fetch → devig → cache write
- `db/cache.ts` — SQLite cache (`bun:sqlite`)
- `server.ts` — Express app, `GET /api/games`, `GET /api/health`

### MLB Stats API endpoints used
```
GET https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=team,linescore
```
**Important caveat:** this is a widely-used, community-verified but
**unofficial** public API. MLB does not publish formal docs or an SLA for
it. It has been stable for years and is the de-facto standard for free MLB
data, but the code defensively null-checks response shape and will skip a
malformed game rather than crash. If this endpoint ever breaks, the
documented fallback is scraping MLB.com's public scoreboard HTML — not
implemented by default since it's more fragile than the API.

### Running the backend
```bash
cd backend
bun install
cp .env.example .env    # set ODDS_PROVIDER and THE_ODDS_API_KEY as needed
bun run dev              # http://localhost:4000
bun test                 # run unit tests
bun run typecheck
```

---

## 4. Frontend Code

See `/frontend/src`:
- `App.tsx` — polls `/api/games` every 30s, renders the grid
- `GameCard.tsx` — per-matchup card: both books' odds + fair %, consensus, baseline stat model
- `api.ts` / `types.ts` / `format.ts` — API client, shared types, display formatting

### Running the frontend
```bash
cd frontend
bun install
cp .env.example .env    # VITE_API_BASE_URL should point at the backend
bun run dev              # http://localhost:5173
bun run build             # production bundle -> dist/
```

---

## 5. Data Pipeline & Odds Source — Legal/ToS Considerations

**FanDuel and DraftKings do not publish public odds APIs, and both platforms'
Terms of Service prohibit automated scraping / data-mining of their site for
republishing.** Odds are commercially licensed data; unauthorized scraping
and redistribution carries real legal risk (rate-limiting, IP bans, and
potential ToS/legal action).

This project **does not scrape either site**. Instead, `ODDS_PROVIDER` in
`.env` selects one of two ToS-safe strategies:

1. **`theoddsapi` (recommended for real odds).** Uses
   [The Odds API](https://the-odds-api.com), which licenses odds data
   directly from books — including FanDuel and DraftKings — and re-serves it
   through a documented REST API (free tier: 500 requests/month). This is
   *not* being used as "the primary source of game data" (that's still the
   free MLB Stats API) — it's solely the licensed conduit for the two named
   books' lines, which have no free/public API of their own.
2. **`mock` (default, zero setup).** Generates clearly-labeled synthetic
   odds so the full app — pipeline, math, dashboard — runs end-to-end with
   no API key and no ToS exposure. Good for development and demos; swap to
   `theoddsapi` before treating any numbers as real.

Pipeline steps (`jobs/poller.ts`):
1. Fetch today's MLB schedule + team records from MLB Stats API.
2. Fetch FanDuel/DraftKings moneylines from the configured odds provider.
3. Match odds to games by normalized team name (MLB Stats API and odds
   providers don't share a common game ID — this is a fuzzy match point;
   an unmatched game simply shows "no odds available" rather than crashing).
4. Convert American odds → implied probability, remove vig per book
   (see math below), average the two books' fair probabilities into a
   consensus, and compute a Log5 baseline from season win% as a secondary
   reference point.
5. Upsert everything into SQLite; API serves from cache.

### Probability math (transparent, unit-tested in `probability.test.ts`)

American odds → raw implied probability:
- Favorite (`odds < 0`): `P = -odds / (-odds + 100)`
- Underdog (`odds > 0`): `P = 100 / (odds + 100)`

Vig removal (two-outcome market): raw probabilities for both sides of one
book's line sum to slightly over 1.0 (that excess is the book's hold/vig).
Normalize to fair probabilities that sum to exactly 1.0:
```
fair_home = raw_home / (raw_home + raw_away)
fair_away = raw_away / (raw_home + raw_away)
```

Consensus: equal-weighted average of FanDuel's and DraftKings' fair
probabilities for the same side.

Baseline stat model: Log5 (Bill James) using each team's season win% from
MLB Stats API records — explicitly documented in code as a simple baseline,
**not** a claim of superior predictive power over the market consensus.

---

## 6. Deployment Instructions

**Backend**: any Node/Bun-compatible host (Render, Railway, Fly.io, EC2,
Fargate). Set env vars: `PORT`, `FRONTEND_ORIGIN` (lock CORS to your deployed
frontend origin), `POLL_INTERVAL_MS`, `ODDS_PROVIDER`, `THE_ODDS_API_KEY`,
`DB_PATH` (mount a persistent volume for the SQLite file if you want cache
to survive restarts — not required, poller repopulates it on boot).

**Frontend**: static build (`bun run build` → `dist/`), deploy to
Vercel/Netlify/S3+CloudFront. Set `VITE_API_BASE_URL` at build time to your
backend's public URL.

**Secrets**: MLB Stats API needs no auth. `THE_ODDS_API_KEY` lives only in
the backend `.env` — never expose it to the frontend bundle.

---

## Project Structure
```
mlb-odds-dashboard/
  backend/    Express + TypeScript API, poller, SQLite cache, tests
  frontend/   React + TypeScript + Vite dashboard
```

# NBA Player Prop Model: Matchup-Adjusted, Variance-Aware

Replaces the old flat season-average + plain Poisson approach with a
real-data predictive model.

## What changed

- **Points** get a real opponent-defense adjustment (ESPN's actual
  `avgPointsAgainst`, vs. league average) combined with a real pace
  adjustment (`estimatedPossessions`).
- **Assists, rebounds, 3PM** get pace-only adjustment. ESPN's public API
  exposes no real "allowed" AST/REB/3PM anywhere — only allowed points —
  confirmed by exhaustively checking every stat category on both team
  stats endpoints. Faking an "allowed" number for those would be
  fabricated precision, so they stay unadjusted on the defense side on
  purpose, not as an oversight.
- **Probabilities** now use each player's own real game-to-game variance
  (pulled from their actual per-game log this season) via a Negative
  Binomial model instead of assuming Poisson smoothness (where variance
  always equals the mean — real box-score stats rarely behave that way:
  hot streaks, blowouts, foul trouble all push real variance above the
  mean).
- Both adjustment factors are clamped to a sane range (0.75–1.3),
  individually and then as a combined product, so one outlier game or
  stat can't produce a wild projection.
- WNBA was left untouched — its matchups are synthetic, so a real-defense
  adjustment wouldn't mean anything there.

## New files

- `backend/src/providers/espnNbaGameLog.ts` — real per-game PTS/AST/REB/
  3PM-made log per athlete, Regular Season only.
- `backend/src/providers/espnNbaTeamStats.ts` — real per-team defense
  (`avgPointsAgainst`) + pace (`estimatedPossessions`), and
  `computeMatchupFactors()` with the two-stage clamp.
- `backend/src/providers/espnNbaTeamStatsCache.ts` — 12h
  stale-while-revalidate cache, same pattern as the roster cache.

## Edited files

- `backend/src/lib/probability.ts` — `sampleVariance()` and
  `negBinomAtLeast()`.
- `backend/src/types.ts` — `NbaPlayerProjection` gained
  `varPts/varAst/varReb/var3PM`.
- `backend/src/providers/espnNbaClient.ts` — roster build now fetches
  each athlete's real game log and computes real variance.
- `backend/src/providers/espnNbaScoreboardProvider.ts` — applies the
  matchup factors to each side's roster per game.

## Verification

- 15 new unit tests (variance math, Negative Binomial behavior,
  matchup-factor clamping) — 51/51 backend tests pass.
- `tsc --noEmit` clean on backend and frontend.
- Frontend build unaffected (39 modules, ~181KB).
- Live end-to-end check against the running backend: fetched 45 real
  games, confirmed the live API serves sane adjusted numbers (e.g. Jalen
  Johnson: 21.6 proj pts, variance ~65 — about 3x his mean, a realistic
  amount of night-to-night swing); all probabilities landed in a sane
  ~35–60% band, no NaN/out-of-range values.

## Honest caveats

- Doesn't account for injuries, minutes changes, or specific lineup
  news — it's a stats-model adjustment, not a news-aware one.
- Points' matchup signal is one aggregate defensive number per team, not
  home/away-split-aware beyond what ESPN already bakes in.
- The roster refresh cycle is now noticeably slower (~2 minutes for the
  full real-schedule fetch, vs. under a minute before) because of the
  added per-player game-log and per-team stats calls. Not on the hot
  per-poll path — it's all cached for 12 hours, so it only costs time on
  the periodic background refresh, not on every dashboard load.

_Last verified: push-from-Aki test, 2026-11-26._

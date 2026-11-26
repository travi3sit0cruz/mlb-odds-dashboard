/**
 * Shared domain types for the MLB odds pipeline.
 */

export type GameStatus = "Preview" | "Live" | "Final" | "Unknown";

export interface LivePlayer {
  id: number;
  name: string;
}

export interface LiveState {
  inning: number | null;
  inningOrdinal: string | null;
  /** "Top" | "Bottom" | "Middle" | "End" */
  inningHalf: string | null;
  balls: number | null;
  strikes: number | null;
  outs: number | null;
  currentPitcher: LivePlayer | null;
  currentBatter: LivePlayer | null;
  /** Strikeouts thrown by currentPitcher in this game so far. Null if unavailable. */
  currentPitcherSO: number | null;
}

export interface TeamInfo {
  id: number;
  name: string;
  winPct?: number;
}

export type AmericanOdds = number | null;

export interface BookLine {
  book: "FanDuel" | "DraftKings";
  homeOdds: AmericanOdds;
  awayOdds: AmericanOdds;
  homeImpliedRaw: number | null;
  awayImpliedRaw: number | null;
  homeImpliedFair: number | null;
  awayImpliedFair: number | null;
  lastUpdated: string | null;
  /**
   * This book's de-vigged fair probability from the PREVIOUS poll cycle for
   * this same game, so the frontend can show which way the line moved since
   * last refresh. Null on a game's first-ever poll, or if this book had no
   * line last cycle either. Never backfilled from anything older than one
   * cycle -- this is lag-1, not a history table.
   */
  prevHomeImpliedFair: number | null;
  prevAwayImpliedFair: number | null;
}

export interface PitcherGameLine {
  date: string;
  opponent: string;
  ip: string;
  so: number;
  h: number;
  er: number;
  hr: number;
  decision: string;
}

export interface PitcherInfo {
  id: number;
  name: string;
  recentStarts: PitcherGameLine[];
  /**
   * Projected SO this start = season SO / season starts (average per start).
   * Null if fewer than 3 starts in the season (not enough sample to be meaningful).
   */
  projSO: number | null;
}

/**
 * One batter in the posted lineup.
 * Projections are season per-game averages — transparent, not proprietary.
 *   projH   = seasonH   / seasonG
 *   projHR  = seasonHR  / seasonG
 *   projRBI = seasonRBI / seasonG
 */
export interface BatterInfo {
  id: number;
  name: string;
  position: string;
  battingOrder: number; // 1–9
  // Season totals
  seasonG: number;
  seasonH: number;
  seasonR: number;
  seasonHR: number;
  seasonRBI: number;
  // Per-game projections: season stat / gamesPlayed
  projH: number;
  projR: number;
  projHR: number;
  projRBI: number;
  // Poisson P(X >= 1): probability of recording at least 1 of each stat tonight
  probH: number;
  probR: number;
  probHR: number;
  probRBI: number;
  // Tonight's actual game stats (0 if game hasn't started or batter hasn't batted yet)
  todayH: number;
  todayR: number;
  todayHR: number;
  todayRBI: number;
}

export interface GameRecord {
  gamePk: number;
  gameDate: string;
  status: GameStatus;
  home: TeamInfo;
  away: TeamInfo;
  homeScore?: number;
  awayScore?: number;
  homePitcher: PitcherInfo | null;
  awayPitcher: PitcherInfo | null;
  /** Live game state (inning + count). Null unless status is "Live". */
  liveState: LiveState | null;
  /** Empty array when lineup not yet posted for that team. */
  homeLineup: BatterInfo[];
  awayLineup: BatterInfo[];
  lines: BookLine[];
  /** prevHomeWinPct/prevAwayWinPct are this same game's consensus from the previous poll cycle (lag-1, null on first poll). */
  consensus: { homeWinPct: number | null; awayWinPct: number | null; prevHomeWinPct: number | null; prevAwayWinPct: number | null };
  statModel:  { homeWinPct: number | null; awayWinPct: number | null };
  fetchedAt: string;
}

export interface OddsProvider {
  name: string;
  getMlbMoneylines(): Promise<OddsQuoteInput[]>;
  /** FanDuel/DraftKings moneylines for tonight WNBA slate. Same licensed-feed path as MLB. */
  getWnbaMoneylines(): Promise<OddsQuoteInput[]>;
  /** FanDuel/DraftKings moneylines for this week's NFL slate. Same licensed-feed path as MLB. */
  getNflMoneylines(): Promise<OddsQuoteInput[]>;
  /** FanDuel/DraftKings moneylines for tonight's NBA slate. Same licensed-feed path as MLB. */
  getNbaMoneylines(): Promise<OddsQuoteInput[]>;
}

export interface OddsQuoteInput {
  book: "FanDuel" | "DraftKings";
  homeTeamName: string;
  awayTeamName: string;
  commenceTimeIso: string;
  homeOdds: AmericanOdds;
  awayOdds: AmericanOdds;
}

// ─── International baseball (NPB / KBO) ──────────────────────────────────────

export interface RunLineGroup {
  /** Home team's point spread, e.g. -1.5 means home gives 1.5 runs. */
  homePoint: number;
  homeOdds: AmericanOdds;
  awayOdds: AmericanOdds;
}

export interface TotalLine {
  line: number;
  overOdds: AmericanOdds;
  underOdds: AmericanOdds;
  overFair: number | null;
  underFair: number | null;
}

export interface IntlTeam {
  name: string;
  abbr: string;
}

export interface IntlGameRecord {
  gameId: string;
  league: "NPB" | "KBO";
  gameDate: string; // ISO UTC
  home: IntlTeam;
  away: IntlTeam;
  /**
   * Heuristic Preview/Live/Final label inferred purely from scheduled start
   * time + a typical game-length window (see estimateStatus() in
   * intlOddsProvider.ts). NOT real live tracking: The Odds API has no
   * Scores & Results coverage for NPB/KBO at any tier, so there is no ToS-safe
   * source of a real status, score, or in-game state for these two leagues.
   */
  estimatedStatus: GameStatus;
  homeScore?: number;
  awayScore?: number;
  moneyline: {
    homeOdds: AmericanOdds;
    awayOdds: AmericanOdds;
    homeFair: number | null;
    awayFair: number | null;
    /** Fair probabilities from the previous poll cycle, for line-movement display. */
    prevHomeFair: number | null;
    prevAwayFair: number | null;
  } | null;
  /** Standard ±1.5 run line. */
  runLine: RunLineGroup | null;
  /** Standard over/under. */
  total: TotalLine | null;
  /** Alt run lines (±0.5, ±2.5, etc.) sorted by homePoint ascending. */
  altRunLines: RunLineGroup[];
  /** Alt totals ±0.5 / ±1 from the standard line. */
  altTotals: TotalLine[];
  fetchedAt: string;
}

export interface IntlGamesResponse {
  provider: string;
  games: IntlGameRecord[];
}

// ─── WNBA (mock: synthetic teams + players; real box-score API TBD) ────────────

export interface WnbaTeam {
  name: string;
  abbr: string;
}

/**
 * One player projection for tonight's game.
 * proj*  = season per-game average (season total / games played) — transparent, not proprietary.
 * prob*  = Poisson P(X >= ceil(proj)): probability of meeting or beating that
 *          average tonight. See poissonAtLeast() in lib/probability.ts for the
 *          math and why k = ceil(proj) is used for a fractional average.
 */
export interface WnbaPlayerProjection {
  id: string;
  name: string;
  team: string;
  position: string; // PG | SG | SF | PF | C
  /** "Starter" = in the starting five tonight; "Bench" = rotation player off the bench. */
  role: "Starter" | "Bench";
  // Season totals
  seasonG: number;
  seasonPts: number;
  seasonAst: number;
  seasonReb: number;
  season3PM: number;
  // Per-game projections: season stat / gamesPlayed
  projPts: number;
  projAst: number;
  projReb: number;
  proj3PM: number;
  // Poisson P(X >= ceil(proj)): probability of meeting/beating tonight's projection
  probPts: number;
  probAst: number;
  probReb: number;
  prob3PM: number;
  // SYNTHETIC "stat so far tonight" — see lib/syntheticLiveStats.ts. These
  // are NOT real box-score numbers (the matchup itself is a synthetic daily
  // pairing, see wnbaProvider.ts); they scale with elapsed game-clock time
  // toward the (real) season-average projection above, deterministically
  // per player+game. 0 before tipoff. UI must label these distinctly from
  // MLB/NFL's real "actual" fields.
  simTodayPts: number;
  simTodayAst: number;
  simTodayReb: number;
  simToday3PM: number;
}

export interface WnbaGameRecord {
  gameId: string;
  gameDate: string; // ISO UTC
  status: GameStatus;
  /** Synthetic estimate (e.g. "Q3 . 4:12 (est.)") derived from elapsed wall-clock
   *  time toward a typical game length -- these matchups are themselves a
   *  synthetic pairing, so this is NOT a real play clock. Null unless Live. */
  liveClock: string | null;
  home: WnbaTeam;
  away: WnbaTeam;
  homeScore?: number;
  awayScore?: number;
  /** Starting five for each side, with tonight's projections. */
  homeRoster: WnbaPlayerProjection[];
  awayRoster: WnbaPlayerProjection[];
  /** FanDuel + DraftKings moneylines, licensed feed (same shape as MLB). Empty if unavailable. */
  lines: BookLine[];
  /** De-vigged average of available book lines. prev* is this game's consensus from the previous poll cycle. */
  consensus: { homeWinPct: number | null; awayWinPct: number | null; prevHomeWinPct: number | null; prevAwayWinPct: number | null };
  fetchedAt: string;
}

export interface WnbaGamesResponse {
  provider: string;
  games: WnbaGameRecord[];
}

// ─── NBA (real teams/rosters/season stats via ESPN; matchup pairing synthetic
//     — same ESPN-schedule-blocked situation as WNBA, see nbaProvider.ts) ───

export interface NbaTeam {
  name: string;
  abbr: string;
}

/**
 * One player projection for tonight's game.
 * proj*  = tonight's expected value. Season per-game average (season total /
 *          games played — transparent, not proprietary), adjusted for
 *          tonight's actual opponent + pace. See computeMatchupFactors() in
 *          espnNbaTeamStats.ts for exactly how, and why only points gets a
 *          defense-strength adjustment (ESPN exposes real "points allowed"
 *          per team but not a real allowed-AST/REB/3PM figure, and this
 *          project only adjusts off real data, never a guessed one).
 * prob*  = Negative-binomial P(X >= ceil(proj)): probability of meeting or
 *          beating tonight's (matchup-adjusted) projection, using this
 *          player's OWN real game-to-game variance this season (not a
 *          textbook-smooth Poisson assumption) — see negBinomAtLeast() and
 *          var* below.
 * var*   = this player's real sample variance this season for that stat,
 *          from their actual game log (espnNbaGameLog.ts), rescaled to
 *          tonight's adjusted mean while preserving the player's own
 *          variance/mean ratio. 0 when too little game-log data exists yet
 *          (falls back to a plain Poisson assumption for that one stat).
 */
export interface NbaPlayerProjection {
  id: string;
  name: string;
  team: string;
  position: string; // PG | SG | SF | PF | C
  /** "Starter" = in the starting five tonight; "Bench" = rotation player off the bench. */
  role: "Starter" | "Bench";
  // Season totals
  seasonG: number;
  seasonPts: number;
  seasonAst: number;
  seasonReb: number;
  season3PM: number;
  // Tonight's expected value: season average, matchup-adjusted (see doc above)
  projPts: number;
  projAst: number;
  projReb: number;
  proj3PM: number;
  // Negative-binomial P(X >= ceil(proj)) using this player's real variance
  probPts: number;
  probAst: number;
  probReb: number;
  prob3PM: number;
  // This player's real sample variance this season (see doc above)
  varPts: number;
  varAst: number;
  varReb: number;
  var3PM: number;
  // SYNTHETIC "stat so far tonight" — see lib/syntheticLiveStats.ts. These
  // are NOT real box-score numbers (the matchup itself is a synthetic daily
  // pairing, see nbaProvider.ts); they scale with elapsed game-clock time
  // toward the (real) season-average projection above, deterministically
  // per player+game. 0 before tipoff. UI must label these distinctly from
  // MLB/NFL's real "actual" fields.
  simTodayPts: number;
  simTodayAst: number;
  simTodayReb: number;
  simToday3PM: number;
  // REAL box-score stats for tonight's actual game, pulled from ESPN's
  // summary endpoint -- see espnNbaLiveStats.ts. Only populated when the
  // game record's `isRealMatchup` is true; 0 otherwise (and mutually
  // exclusive with the sim* fields above -- a game is either real or
  // synthetic-fallback, never both).
  actualPts: number;
  actualAst: number;
  actualReb: number;
  actual3PM: number;
}

export interface NbaGameRecord {
  gameId: string;
  gameDate: string; // ISO UTC
  status: GameStatus;
  /** True when this game's matchup/schedule/score came from ESPN's real NBA
   *  scoreboard (homeRoster/awayRoster's actual* fields are then real
   *  box-score stats). False when ESPN's schedule endpoint was unreachable
   *  this poll cycle and the provider fell back to a synthetic daily slate
   *  (homeRoster/awayRoster's sim* fields are the ones populated instead). */
  isRealMatchup: boolean;
  /** Real play clock + quarter straight from ESPN (e.g. "5:52 - 3rd Quarter")
   *  when isRealMatchup is true; a synthetic estimate (e.g. "Q3 . 4:12 (est.)")
   *  derived from elapsed wall-clock time otherwise. Null unless Live. */
  liveClock: string | null;
  home: NbaTeam;
  away: NbaTeam;
  homeScore?: number;
  awayScore?: number;
  /** Starting five for each side, with tonight's projections. */
  homeRoster: NbaPlayerProjection[];
  awayRoster: NbaPlayerProjection[];
  /** FanDuel + DraftKings moneylines, licensed feed (same shape as MLB). Empty if unavailable. */
  lines: BookLine[];
  /** De-vigged average of available book lines. prev* is this game's consensus from the previous poll cycle. */
  consensus: { homeWinPct: number | null; awayWinPct: number | null; prevHomeWinPct: number | null; prevAwayWinPct: number | null };
  /** Internal consistency check against ESPN's own data this poll cycle --
   *  see lib/statsSanity.ts. Null means nothing looked wrong (including the
   *  normal pregame case where there's no box score yet). Only ever set
   *  when isRealMatchup is true; synthetic-fallback games are never
   *  sanity-checked against themselves. */
  statsSanityWarning: string | null;
  fetchedAt: string;
}

export interface NbaGamesResponse {
  provider: string;
  games: NbaGameRecord[];
}

// ─── NFL (real teams/schedule via ESPN; odds mock or licensed feed) ─────────

export interface NflTeam {
  name: string;
  abbr: string;
}

/**
 * One skill-position player's season-average "prop" projection for tonight's
 * game. Only QB/RB/FB/WR/TE are modeled — see espnNflClient.ts for why.
 * Column semantics are position-dependent (a QB's main number is pass
 * yards, a WR's is receiving yards), so each row carries its own labels
 * rather than forcing every position into the same fixed stat columns.
 *   proj*  = matchup-adjusted projection (season average x real opponent
 *            defense-strength x real pace -- see espnNflTeamStats.ts;
 *            unadjusted season average if tonight's matchup factors
 *            aren't available yet). Yds and TD share one real defense
 *            factor (points-allowed-based, since ESPN exposes no real
 *            split yards/TD-allowed data); RecOrAtt (completions/
 *            attempts/receptions) gets pace only, no defense component.
 *   prob*  = Negative Binomial P(X >= ceil(proj)) using this player's own
 *            real game-log variance (see espnNflGameLog.ts); falls back to
 *            Poisson when variance is unknown or not overdispersed.
 *   var*   = real sample variance (rescaled to tonight's adjusted mean,
 *            preserving the player's own variance/mean ratio). 0 means
 *            unknown/insufficient game-log data -- signals the Poisson
 *            fallback above, not an invented number.
 */
export interface NflPlayerProjection {
  id: string;
  name: string;
  team: string;
  position: string; // QB | RB | FB | WR | TE
  seasonG: number;
  seasonYds: number;
  seasonTD: number;
  seasonRecOrAtt: number;
  projYds: number;
  projTD: number;
  projRecOrAtt: number;
  probYds: number;
  probTD: number;
  probRecOrAtt: number;
  varYds: number;
  varTD: number;
  varRecOrAtt: number;
  /** "Pass Yds" | "Rush Yds" | "Rec Yds" */
  ydsLabel: string;
  /** "Pass TD" | "TD" */
  tdLabel: string;
  /** "Comp" | "Att" | "Rec" */
  thirdLabel: string;
  // Real, live box-score totals accumulated so far in tonight's actual game
  // (not the season average above). 0 before kickoff or if ESPN's live
  // boxscore host didn't respond this cycle; real data, same source as the
  // schedule/scores, pulled only while status is "Live".
  actualYds: number;
  actualTD: number;
  actualRecOrAtt: number;
}

export interface NflGameRecord {
  gameId: string;
  gameDate: string; // ISO UTC
  status: GameStatus;
  /** Real play clock + quarter from ESPN (e.g. "5:52 - 3rd Quarter"). Null unless Live. */
  liveClock: string | null;
  week: number | null;
  venue: string | null;
  home: NflTeam;
  away: NflTeam;
  homeScore?: number;
  awayScore?: number;
  /** Real skill-position rosters with season-average prop projections. Empty if ESPN roster fetch hasn't completed yet. */
  homeRoster: NflPlayerProjection[];
  awayRoster: NflPlayerProjection[];
  /** FanDuel + DraftKings moneylines (same shape as MLB/WNBA). Empty if unavailable. */
  lines: BookLine[];
  /** De-vigged average of available book lines. prev* is this game's consensus from the previous poll cycle. */
  consensus: { homeWinPct: number | null; awayWinPct: number | null; prevHomeWinPct: number | null; prevAwayWinPct: number | null };
  /** Internal consistency check against ESPN's own data this poll cycle --
   *  see lib/statsSanity.ts (monotonic-stat check only; NFL has no clean
   *  score-sum check since actualYds isn't the stat that produces the
   *  score). Null means nothing looked wrong. */
  statsSanityWarning: string | null;
  fetchedAt: string;
}

export interface NflGamesResponse {
  provider: string;
  games: NflGameRecord[];
}

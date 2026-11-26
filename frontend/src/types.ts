export type GameStatus = "Preview" | "Live" | "Final" | "Unknown";

export interface LivePlayer {
  id: number;
  name: string;
}

export interface LiveState {
  inning: number | null;
  inningOrdinal: string | null;
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
  /** This book's fair probability from the previous poll cycle (lag-1), for line-movement display. */
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
  projSO: number | null;
}

export interface BatterInfo {
  id: number;
  name: string;
  position: string;
  battingOrder: number;
  seasonG: number;
  seasonH: number;
  seasonR: number;
  seasonHR: number;
  seasonRBI: number;
  projH: number;
  projR: number;
  projHR: number;
  projRBI: number;
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
  liveState: LiveState | null;
  homeLineup: BatterInfo[];
  awayLineup: BatterInfo[];
  lines: BookLine[];
  consensus: { homeWinPct: number | null; awayWinPct: number | null; prevHomeWinPct: number | null; prevAwayWinPct: number | null };
  statModel:  { homeWinPct: number | null; awayWinPct: number | null };
  fetchedAt: string;
}

export interface GamesResponse {
  provider: string;
  games: GameRecord[];
}

// ─── International baseball (NPB / KBO) ──────────────────────────────────────

export interface RunLineGroup {
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
  gameDate: string;
  home: IntlTeam;
  away: IntlTeam;
  /**
   * Heuristic Preview/Live/Final label inferred from scheduled start time —
   * NOT real live data. The Odds API has no Scores & Results coverage for
   * NPB/KBO at any tier, so there is no real status/score/in-game state
   * available for these two leagues through any ToS-safe source.
   */
  estimatedStatus: GameStatus;
  homeScore?: number;
  awayScore?: number;
  moneyline: {
    homeOdds: AmericanOdds;
    awayOdds: AmericanOdds;
    homeFair: number | null;
    awayFair: number | null;
    /** Fair probabilities from the previous poll cycle (lag-1), for line-movement display. */
    prevHomeFair: number | null;
    prevAwayFair: number | null;
  } | null;
  runLine: RunLineGroup | null;
  total: TotalLine | null;
  altRunLines: RunLineGroup[];
  altTotals: TotalLine[];
  fetchedAt: string;
}

export interface IntlGamesResponse {
  provider: string;
  games: IntlGameRecord[];
}

export interface WnbaTeam {
  name: string;
  abbr: string;
}

export interface WnbaPlayerProjection {
  id: string;
  name: string;
  team: string;
  position: string;
  role: "Starter" | "Bench";
  seasonG: number;
  seasonPts: number;
  seasonAst: number;
  seasonReb: number;
  season3PM: number;
  projPts: number;
  projAst: number;
  projReb: number;
  proj3PM: number;
  probPts: number;
  probAst: number;
  probReb: number;
  prob3PM: number;
  simTodayPts: number;
  simTodayAst: number;
  simTodayReb: number;
  simToday3PM: number;
}

export interface WnbaGameRecord {
  gameId: string;
  gameDate: string;
  status: GameStatus;
  liveClock: string | null;
  home: WnbaTeam;
  away: WnbaTeam;
  homeScore?: number;
  awayScore?: number;
  homeRoster: WnbaPlayerProjection[];
  awayRoster: WnbaPlayerProjection[];
  lines: BookLine[];
  consensus: { homeWinPct: number | null; awayWinPct: number | null; prevHomeWinPct: number | null; prevAwayWinPct: number | null };
  fetchedAt: string;
}

export interface WnbaGamesResponse {
  provider: string;
  games: WnbaGameRecord[];
}

export interface NbaTeam {
  name: string;
  abbr: string;
}

export interface NbaPlayerProjection {
  id: string;
  name: string;
  team: string;
  position: string;
  role: "Starter" | "Bench";
  seasonG: number;
  seasonPts: number;
  seasonAst: number;
  seasonReb: number;
  season3PM: number;
  projPts: number;
  projAst: number;
  projReb: number;
  proj3PM: number;
  probPts: number;
  probAst: number;
  probReb: number;
  prob3PM: number;
  simTodayPts: number;
  simTodayAst: number;
  simTodayReb: number;
  simToday3PM: number;
  actualPts: number;
  actualAst: number;
  actualReb: number;
  actual3PM: number;
}

export interface NbaGameRecord {
  gameId: string;
  gameDate: string;
  status: GameStatus;
  isRealMatchup: boolean;
  liveClock: string | null;
  home: NbaTeam;
  away: NbaTeam;
  homeScore?: number;
  awayScore?: number;
  homeRoster: NbaPlayerProjection[];
  awayRoster: NbaPlayerProjection[];
  lines: BookLine[];
  consensus: { homeWinPct: number | null; awayWinPct: number | null; prevHomeWinPct: number | null; prevAwayWinPct: number | null };
  statsSanityWarning: string | null;
  fetchedAt: string;
}

export interface NbaGamesResponse {
  provider: string;
  games: NbaGameRecord[];
}

export interface NflTeam {
  name: string;
  abbr: string;
}

export interface NflPlayerProjection {
  id: string;
  name: string;
  team: string;
  position: string;
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
  ydsLabel: string;
  tdLabel: string;
  thirdLabel: string;
  actualYds: number;
  actualTD: number;
  actualRecOrAtt: number;
}

export interface NflGameRecord {
  gameId: string;
  gameDate: string;
  status: GameStatus;
  liveClock: string | null;
  week: number | null;
  venue: string | null;
  home: NflTeam;
  away: NflTeam;
  homeScore?: number;
  awayScore?: number;
  homeRoster: NflPlayerProjection[];
  awayRoster: NflPlayerProjection[];
  lines: BookLine[];
  consensus: { homeWinPct: number | null; awayWinPct: number | null; prevHomeWinPct: number | null; prevAwayWinPct: number | null };
  statsSanityWarning: string | null;
  fetchedAt: string;
}

export interface NflGamesResponse {
  provider: string;
  games: NflGameRecord[];
}

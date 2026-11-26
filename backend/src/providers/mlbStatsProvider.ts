/**
 * MLB Stats API client (statsapi.mlb.com).
 *
 * NOTE: Unofficial but widely-used public API. No published SLA.
 * All fields are null-checked; bad shapes skip the affected record
 * rather than crash the poller.
 *
 * Endpoints:
 *   Schedule:  GET /api/v1/schedule?sportId=1&date=YYYY-MM-DD
 *                  &hydrate=team,linescore,probablePitcher
 *   Pitcher:   GET /api/v1/people/{id}/stats
 *                  ?stats=gameLog&group=pitching&season=YYYY
 *   Boxscore:  GET /api/v1/game/{gamePk}/boxscore
 *              (includes batting order + per-player season stats once lineup posted)
 */

import type {
  BatterInfo,
  GameRecord,
  GameStatus,
  LivePlayer,
  LiveState,
  PitcherGameLine,
  PitcherInfo,
  TeamInfo,
} from "../types.js";
import { poissonAtLeastOne } from "../lib/probability.js";

const BASE = "https://statsapi.mlb.com/api/v1";

// ─── Schedule ────────────────────────────────────────────────────────────────

interface ScheduleResponse {
  dates: { games: RawGame[] }[];
}
interface RawProbablePitcher { id: number; fullName: string }
interface RawGame {
  gamePk: number;
  gameDate: string;
  status: { detailedState: string; abstractGameState: string };
  teams: { home: RawTeamSide; away: RawTeamSide };
  linescore?: RawLinescore;
}
interface RawLinescore {
  currentInning?: number;
  currentInningOrdinal?: string;
  inningState?: string; // "Top" | "Bottom" | "Middle" | "End"
  balls?: number;
  strikes?: number;
  outs?: number;
  defense?: { pitcher?: RawPerson };
  offense?: { batter?: RawPerson };
}
interface RawPerson {
  id: number;
  fullName: string;
}
interface RawTeamSide {
  team: { id: number; name: string };
  score?: number;
  leagueRecord?: { wins: number; losses: number; pct: string };
  probablePitcher?: RawProbablePitcher;
}

function mapStatus(s: string): GameStatus {
  if (s === "Preview") return "Preview";
  if (s === "Live")    return "Live";
  if (s === "Final")   return "Final";
  return "Unknown";
}
function toLivePlayer(p?: RawPerson): LivePlayer | null {
  return p ? { id: p.id, name: p.fullName } : null;
}
function toLiveState(status: GameStatus, ls?: RawLinescore): LiveState | null {
  if (status !== "Live" || !ls) return null;
  return {
    inning:         ls.currentInning ?? null,
    inningOrdinal:  ls.currentInningOrdinal ?? null,
    inningHalf:     ls.inningState ?? null,
    balls:          ls.balls ?? null,
    strikes:        ls.strikes ?? null,
    outs:           ls.outs ?? null,
    currentPitcher: toLivePlayer(ls.defense?.pitcher),
    currentBatter:  toLivePlayer(ls.offense?.batter),
    // Populated later by the poller once boxscore pitching stats are fetched.
    currentPitcherSO: null,
  };
}
function toTeamInfo(side: RawTeamSide): TeamInfo {
  const pct = side.leagueRecord?.pct ? parseFloat(side.leagueRecord.pct) : undefined;
  return { id: side.team.id, name: side.team.name, winPct: Number.isFinite(pct) ? pct : undefined };
}

export type GameSkeleton = Pick<
  GameRecord,
  "gamePk" | "gameDate" | "status" | "home" | "away" | "homeScore" | "awayScore" | "liveState"
> & {
  homeProbablePitcherId:   number | null;
  homeProbablePitcherName: string | null;
  awayProbablePitcherId:   number | null;
  awayProbablePitcherName: string | null;
};

export async function fetchTodaysGames(date: Date = new Date()): Promise<GameSkeleton[]> {
  const d = date.toISOString().slice(0, 10);
  const res = await fetch(`${BASE}/schedule?sportId=1&date=${d}&hydrate=team,linescore,probablePitcher`);
  if (!res.ok) throw new Error(`MLB schedule: ${res.status}`);
  const data = (await res.json()) as ScheduleResponse;
  return data.dates
    .flatMap((d) => d.games)
    .filter((g) => g?.teams?.home?.team && g?.teams?.away?.team)
    .map((g) => ({
      gamePk:    g.gamePk,
      gameDate:  g.gameDate,
      status:    mapStatus(g.status.abstractGameState),
      liveState: toLiveState(mapStatus(g.status.abstractGameState), g.linescore),
      home:      toTeamInfo(g.teams.home),
      away:      toTeamInfo(g.teams.away),
      homeScore: g.teams.home.score,
      awayScore: g.teams.away.score,
      homeProbablePitcherId:   g.teams.home.probablePitcher?.id   ?? null,
      homeProbablePitcherName: g.teams.home.probablePitcher?.fullName ?? null,
      awayProbablePitcherId:   g.teams.away.probablePitcher?.id   ?? null,
      awayProbablePitcherName: g.teams.away.probablePitcher?.fullName ?? null,
    }));
}

// ─── Pitcher game log + projSO ────────────────────────────────────────────────

interface PitcherLogResponse {
  stats: { splits: PitcherLogSplit[] }[];
}
interface PitcherLogSplit {
  date?:      string;
  gameType?:  string;
  opponent?:  { name: string };
  stat: {
    gamesStarted?:   number;
    inningsPitched?: string;
    strikeOuts?:     number;
    hits?:           number;
    earnedRuns?:     number;
    homeRuns?:       number;
    wins?:           number;
    losses?:         number;
  };
}

function ipToDecimal(ip: string): number {
  // "6.1" = 6 + 1/3 innings, "6.2" = 6 + 2/3
  const [whole = "0", thirds = "0"] = ip.split(".");
  return parseInt(whole) + parseInt(thirds) / 3;
}
function splitDecision(s: PitcherLogSplit): string {
  if ((s.stat.wins   ?? 0) > 0) return "W";
  if ((s.stat.losses ?? 0) > 0) return "L";
  return "ND";
}

export async function fetchPitcherData(
  pitcherId: number,
  season: number = new Date().getFullYear(),
): Promise<{ recentStarts: PitcherGameLine[]; projSO: number | null }> {
  const url = `${BASE}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}`;
  let res: Response;
  try { res = await fetch(url); } catch { return { recentStarts: [], projSO: null }; }
  if (!res.ok) { return { recentStarts: [], projSO: null }; }

  const data  = (await res.json()) as PitcherLogResponse;
  const all   = (data.stats?.[0]?.splits ?? [])
    .filter((s) => s.gameType === "R" && (s.stat.gamesStarted ?? 0) >= 1);

  // projSO: season average SO per start (need at least 3 starts for a meaningful number)
  const projSO = all.length >= 3
    ? Math.round(all.reduce((sum, s) => sum + (s.stat.strikeOuts ?? 0), 0) / all.length * 10) / 10
    : null;

  const recentStarts = all
    .slice(-5)
    .reverse()
    .map((s): PitcherGameLine => ({
      date:     s.date ?? "",
      opponent: s.opponent?.name ?? "—",
      ip:       s.stat.inningsPitched ?? "—",
      so:       s.stat.strikeOuts  ?? 0,
      h:        s.stat.hits        ?? 0,
      er:       s.stat.earnedRuns  ?? 0,
      hr:       s.stat.homeRuns    ?? 0,
      decision: splitDecision(s),
    }));

  // suppress unused-variable warning for ipToDecimal (used in future ERA calc)
  void ipToDecimal;

  return { recentStarts, projSO };
}

export async function fetchAllPitcherStats(
  games: GameSkeleton[],
): Promise<Map<number, PitcherInfo>> {
  const unique = new Map<number, string>();
  for (const g of games) {
    if (g.homeProbablePitcherId) unique.set(g.homeProbablePitcherId, g.homeProbablePitcherName!);
    if (g.awayProbablePitcherId) unique.set(g.awayProbablePitcherId, g.awayProbablePitcherName!);
  }
  const ids     = [...unique.keys()];
  const results = await pLimit(ids.map((id) => () => fetchPitcherData(id)), 8);
  const map     = new Map<number, PitcherInfo>();
  ids.forEach((id, i) => {
    const r = results[i] ?? { recentStarts: [], projSO: null };
    map.set(id, { id, name: unique.get(id)!, ...r });
  });
  return map;
}

// ─── Boxscore: lineup + per-batter season stats ───────────────────────────────
//
// Endpoint: GET /api/v1/game/{gamePk}/boxscore
// When the lineup is officially posted (typically 30–60 min before first pitch),
// battingOrder is populated and each player entry includes seasonStats.batting.
// Returns empty arrays when lineup isn't posted yet — handled gracefully.

interface BoxscoreResponse {
  teams: {
    home: BoxscoreTeamData;
    away: BoxscoreTeamData;
  };
}
interface BoxscoreTeamData {
  battingOrder?: number[];
  players: Record<string, BoxscorePlayer>;
}
interface BoxscorePlayer {
  person:        { id: number; fullName: string };
  position?:     { abbreviation: string };
  battingOrder?: string; // "1", "2" ... "9" (string in the API)
  seasonStats?: {
    batting?: {
      gamesPlayed?: number;
      hits?:        number;
      runs?:        number;
      homeRuns?:    number;
      rbi?:         number;
    };
  };
  stats?: {
    pitching?: {
      strikeOuts?: number; // this game only, empty {} for non-pitchers
    };
    batting?: {
      hits?: number;
      runs?: number;
      homeRuns?: number;
      rbi?: number;
    };
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function parseBatterInfo(player: BoxscorePlayer, orderPos: number): BatterInfo | null {
  const batting = player.seasonStats?.batting;
  const g  = batting?.gamesPlayed ?? 0;
  if (g === 0) return null; // skip players with no season data (avoids division by zero)
  const h   = batting?.hits      ?? 0;
  const r   = batting?.runs      ?? 0;
  const hr  = batting?.homeRuns  ?? 0;
  const rbi = batting?.rbi       ?? 0;
  const projH   = round2(h   / g);
  const projR   = round2(r   / g);
  const projRBI = round2(rbi / g);
  return {
    id:           player.person.id,
    name:         player.person.fullName,
    position:     player.position?.abbreviation ?? "—",
    battingOrder: orderPos,
    seasonG:   g,
    seasonH:   h,
    seasonR:   r,
    seasonHR:  hr,
    seasonRBI: rbi,
    projH,
    projR,
    projHR:    round2(hr  / g),
    projRBI,
    // Poisson P(X >= 1): probability of recording at least 1 of each stat tonight
    probH:   round2(poissonAtLeastOne(projH)),
    probR:   round2(poissonAtLeastOne(projR)),
    probHR:  round2(poissonAtLeastOne(round2(hr / g))),
    probRBI: round2(poissonAtLeastOne(projRBI)),
    // Tonight's in-game stats (0 when game hasn't started or player hasn't appeared)
    todayH:   player.stats?.batting?.hits      ?? 0,
    todayR:   player.stats?.batting?.runs      ?? 0,
    todayHR:  player.stats?.batting?.homeRuns  ?? 0,
    todayRBI: player.stats?.batting?.rbi       ?? 0,
  };
}

export interface GameLineup {
  home: BatterInfo[];
  away: BatterInfo[];
  /** playerId -> strikeouts thrown in this game so far (live pitching line). */
  pitcherSO: Map<number, number>;
}

export async function fetchGameLineup(gamePk: number): Promise<GameLineup> {
  const empty: GameLineup = { home: [], away: [], pitcherSO: new Map() };
  let res: Response;
  try { res = await fetch(`${BASE}/game/${gamePk}/boxscore`); } catch { return empty; }
  if (!res.ok) return empty;

  const data = (await res.json()) as BoxscoreResponse;

  function extractLineup(team: BoxscoreTeamData): BatterInfo[] {
    const order = team.battingOrder ?? [];
    if (order.length === 0) return [];
    return order
      .map((pid, idx) => {
        const key    = `ID${pid}`;
        const player = team.players[key];
        if (!player) return null;
        return parseBatterInfo(player, idx + 1);
      })
      .filter((b): b is BatterInfo => b !== null);
  }

  const pitcherSO = new Map<number, number>();
  for (const team of [data.teams.home, data.teams.away]) {
    for (const player of Object.values(team.players)) {
      const so = player.stats?.pitching?.strikeOuts;
      if (so !== undefined) pitcherSO.set(player.person.id, so);
    }
  }

  return {
    home: extractLineup(data.teams.home),
    away: extractLineup(data.teams.away),
    pitcherSO,
  };
}

export async function fetchAllLineups(
  games: GameSkeleton[],
): Promise<Map<number, GameLineup>> {
  const tasks   = games.map((g) => () => fetchGameLineup(g.gamePk));
  const results = await pLimit(tasks, 8);
  const map     = new Map<number, GameLineup>();
  games.forEach((g, i) => {
    map.set(g.gamePk, results[i] ?? { home: [], away: [], pitcherSO: new Map() });
  });
  return map;
}

// ─── Concurrency limiter ──────────────────────────────────────────────────────

async function pLimit<T>(tasks: (() => Promise<T>)[], concurrency = 8): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

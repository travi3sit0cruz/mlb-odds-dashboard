/**
 * Odds provider for NPB (Japan) and KBO (South Korea) baseball.
 *
 * Real path: The Odds API sport keys baseball_npb / baseball_kbo.
 *   Markets: h2h (ML), spreads (run line ±1.5), totals, alternate_spreads.
 *   Uses the same THE_ODDS_API_KEY as the MLB provider.
 *
 * Mock path: synthetic games with realistic Japanese / Korean team names,
 *   generated fresh each call so times and scores feel current.
 */

import type { AmericanOdds, GameStatus, IntlGameRecord, RunLineGroup, TotalLine } from "../types.js";
import { devigMoneyline } from "../lib/probability.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ml(raw: number): number { return raw; }

function devig(homeOdds: number, awayOdds: number) {
  try {
    const r = devigMoneyline(homeOdds, awayOdds);
    return { homeFair: r.homeFair, awayFair: r.awayFair };
  } catch {
    return { homeFair: null, awayFair: null };
  }
}

function devigTotal(overOdds: number, underOdds: number) {
  try {
    const r = devigMoneyline(overOdds, underOdds);
    return { overFair: r.homeFair, underFair: r.awayFair };
  } catch {
    return { overFair: null, underFair: null };
  }
}

/**
 * NPB/KBO have no real live/score data through any ToS-safe source: The Odds
 * API's own sports coverage table shows Scores & Results checked for
 * baseball_mlb and basketball_wnba but unchecked for baseball_npb and
 * baseball_kbo, at every tier. This infers Preview/Live/Final purely from
 * scheduled start time + a typical game-length window — it is an estimate,
 * never real live state, and must never be paired with a fabricated score,
 * inning, or batter/pitcher.
 */
function estimateStatus(gameDate: Date, now: Date): GameStatus {
  const diffMs = now.getTime() - gameDate.getTime();
  if (diffMs < 0) return "Preview";
  if (diffMs < 3.25 * 60 * 60 * 1000) return "Live"; // NPB/KBO games typically run ~3-3.5h
  return "Final";
}

/** Build alt run-line set from a base spread and favourite indicator. */
function buildAltRunLines(homeFav: boolean, base: number = 1.5): RunLineGroup[] {
  // spreads relative to home: negative means home gives runs (home favored)
  const spreads = homeFav
    ? [-0.5, -1.5, -2.5]
    : [0.5, 1.5, 2.5];

  return spreads.map((homePoint) => {
    const dist = Math.abs(homePoint);
    // odds get worse for larger spreads when giving runs, better when taking
    const homeMult = homeFav ? -120 - (dist - 0.5) * 40 : 100 + (dist - 0.5) * 40;
    const awayMult = homeFav ? 100 + (dist - 0.5) * 40 : -120 - (dist - 0.5) * 40;
    return { homePoint, homeOdds: ml(Math.round(homeMult)), awayOdds: ml(Math.round(awayMult)) };
  });
}

function buildAltTotals(base: number): TotalLine[] {
  return [-1, 0, 0.5, 1].map((offset) => {
    const overOdds  = ml(offset < 0 ? -130 : offset === 0 ? -110 : 115);
    const underOdds = ml(offset < 0 ?  110 : offset === 0 ? -110 : -135);
    return { line: base + offset, overOdds, underOdds, ...devigTotal(overOdds, underOdds) };
  });
}

// ─── Team rosters ─────────────────────────────────────────────────────────────

const NPB_TEAMS = [
  { name: "Yomiuri Giants",          abbr: "GNT" },
  { name: "Hanshin Tigers",          abbr: "HAN" },
  { name: "Hiroshima Toyo Carp",     abbr: "CAR" },
  { name: "Yakult Swallows",         abbr: "YKL" },
  { name: "DeNA BayStars",           abbr: "BAY" },
  { name: "Chunichi Dragons",        abbr: "DRG" },
  { name: "SoftBank Hawks",          abbr: "HWK" },
  { name: "Orix Buffaloes",          abbr: "ORI" },
  { name: "Seibu Lions",             abbr: "LIO" },
  { name: "Rakuten Eagles",          abbr: "EGL" },
  { name: "Lotte Marines",           abbr: "MAR" },
  { name: "Nippon Ham Fighters",     abbr: "FTR" },
];

const KBO_TEAMS = [
  { name: "KIA Tigers",              abbr: "KIA" },
  { name: "Samsung Lions",          abbr: "SAM" },
  { name: "LG Twins",               abbr: "LGT" },
  { name: "SSG Landers",            abbr: "SSG" },
  { name: "KT Wiz",                 abbr: "KTW" },
  { name: "Doosan Bears",           abbr: "DUS" },
  { name: "NC Dinos",               abbr: "NCD" },
  { name: "Lotte Giants",           abbr: "LOT" },
  { name: "Hanwha Eagles",          abbr: "HWE" },
  { name: "Kiwoom Heroes",          abbr: "KIW" },
];

// ─── Mock generator ───────────────────────────────────────────────────────────

function mockGames(date: Date): IntlGameRecord[] {
  const games: IntlGameRecord[] = [];
  const now = date.toISOString();

  // Fixed pairings for today — deterministic per date so rerenders don't shuffle
  const dateStr = date.toISOString().slice(0, 10);
  const seed = dateStr.split("-").reduce((a, b) => a + parseInt(b), 0);

  function pick<T>(arr: T[], offset: number): T {
    return arr[(seed + offset) % arr.length]!;
  }

  // NPB: 6 games (whole slate), staggered across day
  const npbPairs = [
    [0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11],
  ] as const;
  // game times: 03:00, 03:30, 09:00, 09:30, 10:00, 10:30 UTC (evening JST)
  const npbTimes = ["03:00", "03:30", "09:00", "09:30", "10:00", "10:30"];

  npbPairs.forEach(([ai, hi], i) => {
    const away = pick(NPB_TEAMS, ai + seed);
    const home = pick(NPB_TEAMS, hi + seed + 1);
    if (away.abbr === home.abbr) return; // skip same team
    const gameDate = `${dateStr}T${npbTimes[i]}:00Z`;
    const homeML = -130 + ((seed + i) % 7) * 15;
    const awayML = homeML < 0 ? Math.round((-homeML - 10) * 0.9) : Math.round((-homeML) * 0.9);
    const { homeFair, awayFair } = devig(homeML, awayML);
    const homeFav = homeML < 0;
    const totalBase = 7.5 + (i % 3) * 0.5;

    games.push({
      gameId: `npb-${dateStr}-${i}`,
      league: "NPB",
      gameDate,
      home,
      away,
      estimatedStatus: estimateStatus(new Date(gameDate), date),
      moneyline: { homeOdds: homeML, awayOdds: awayML, homeFair, awayFair, prevHomeFair: null, prevAwayFair: null },
      runLine: buildAltRunLines(homeFav, 1.5).find(r => Math.abs(r.homePoint) === 1.5) ?? null,
      total: { line: totalBase, overOdds: -110, underOdds: -110, ...devigTotal(-110, -110) },
      altRunLines: buildAltRunLines(homeFav, 1.5).filter(r => Math.abs(r.homePoint) !== 1.5),
      altTotals: buildAltTotals(totalBase),
      fetchedAt: now,
    });
  });

  // KBO: 5 games, slightly later UTC (afternoon KST)
  const kboPairs = [[0,1],[2,3],[4,5],[6,7],[8,9]] as const;
  const kboTimes = ["05:00", "08:00", "08:30", "09:00", "09:30"];

  kboPairs.forEach(([ai, hi], i) => {
    const away = KBO_TEAMS[ai]!;
    const home = KBO_TEAMS[hi]!;
    const gameDate = `${dateStr}T${kboTimes[i]}:00Z`;
    const homeML = -120 + ((seed + i * 3) % 8) * 15;
    const awayML = homeML < 0 ? Math.round((-homeML - 10) * 0.9) : Math.round((-homeML) * 0.9);
    const { homeFair, awayFair } = devig(homeML, awayML);
    const homeFav = homeML < 0;
    const totalBase = 8 + (i % 4) * 0.5;

    games.push({
      gameId: `kbo-${dateStr}-${i}`,
      league: "KBO",
      gameDate,
      home,
      away,
      estimatedStatus: estimateStatus(new Date(gameDate), date),
      moneyline: { homeOdds: homeML, awayOdds: awayML, homeFair, awayFair, prevHomeFair: null, prevAwayFair: null },
      runLine: buildAltRunLines(homeFav, 1.5).find(r => Math.abs(r.homePoint) === 1.5) ?? null,
      total: { line: totalBase, overOdds: -110, underOdds: -110, ...devigTotal(-110, -110) },
      altRunLines: buildAltRunLines(homeFav, 1.5).filter(r => Math.abs(r.homePoint) !== 1.5),
      altTotals: buildAltTotals(totalBase),
      fetchedAt: now,
    });
  });

  return games.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
}

// ─── The Odds API (real) ──────────────────────────────────────────────────────

const ODDS_BASE = "https://api.the-odds-api.com/v4/sports";

interface OddsEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: {
    key: string;
    markets: {
      key: string; // "h2h" | "spreads" | "totals" | "alternate_spreads"
      outcomes: { name: string; price: number; point?: number }[];
    }[];
  }[];
}

function firstBook(events: OddsEvent[], marketKey: string) {
  // Pick first available bookmaker that has this market
  return (event: OddsEvent) =>
    event.bookmakers.flatMap((b) => b.markets).find((m) => m.key === marketKey)?.outcomes ?? [];
}

async function fetchLeagueOdds(apiKey: string, sportKey: string): Promise<OddsEvent[]> {
  const markets = "h2h,spreads,totals,alternate_spreads,alternate_totals";
  const url = `${ODDS_BASE}/${sportKey}/odds?apiKey=${apiKey}&regions=us,eu&markets=${markets}&oddsFormat=american`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Odds API ${sportKey}: ${res.status}`);
  return res.json() as Promise<OddsEvent[]>;
}

function parseOddsEvent(event: OddsEvent, league: "NPB" | "KBO"): IntlGameRecord {
  const getOutcomes = firstBook([event], "h2h");
  const h2h = getOutcomes(event);
  const homeH2h = h2h.find((o) => o.name === event.home_team);
  const awayH2h = h2h.find((o) => o.name === event.away_team);
  const homeOdds = homeH2h?.price ?? null;
  const awayOdds = awayH2h?.price ?? null;
  const { homeFair, awayFair } = homeOdds && awayOdds ? devig(homeOdds, awayOdds) : { homeFair: null, awayFair: null };

  const spreads = firstBook([event], "spreads")(event);
  const homeSpread = spreads.find((o) => o.name === event.home_team);
  const awaySpread = spreads.find((o) => o.name === event.away_team);
  const runLine: RunLineGroup | null = homeSpread?.point != null && awaySpread
    ? { homePoint: homeSpread.point, homeOdds: homeSpread.price, awayOdds: awaySpread.price }
    : null;

  const tots = firstBook([event], "totals")(event);
  const over = tots.find((o) => o.name === "Over");
  const under = tots.find((o) => o.name === "Under");
  const total: TotalLine | null = over?.point != null && under
    ? { line: over.point, overOdds: over.price, underOdds: under.price, ...devigTotal(over.price, under.price) }
    : null;

  // Alt run lines: group outcomes by point, keep unique home points
  const altSpreads = firstBook([event], "alternate_spreads")(event);
  const altRunMap = new Map<number, RunLineGroup>();
  for (const o of altSpreads) {
    if (o.point == null) continue;
    const isHome = o.name === event.home_team;
    const existing = altRunMap.get(o.point);
    if (existing) {
      if (isHome) existing.homeOdds = o.price; else existing.awayOdds = o.price;
    } else {
      altRunMap.set(o.point, {
        homePoint: isHome ? o.point : -o.point,
        homeOdds: isHome ? o.price : null as unknown as number,
        awayOdds: isHome ? null as unknown as number : o.price,
      });
    }
  }
  const altRunLines = Array.from(altRunMap.values())
    .filter((r) => r.homeOdds != null && r.awayOdds != null && Math.abs(r.homePoint) !== 1.5)
    .sort((a, b) => a.homePoint - b.homePoint);

  const altTotalsOutcomes = firstBook([event], "alternate_totals")(event);
  const altTotMap = new Map<number, TotalLine>();
  for (const o of altTotalsOutcomes) {
    if (o.point == null) continue;
    const existing = altTotMap.get(o.point);
    if (existing) {
      if (o.name === "Over") existing.overOdds = o.price; else existing.underOdds = o.price;
    } else {
      altTotMap.set(o.point, {
        line: o.point,
        overOdds: o.name === "Over" ? o.price : null as unknown as number,
        underOdds: o.name === "Under" ? o.price : null as unknown as number,
        overFair: null, underFair: null,
      });
    }
  }
  const altTotals = Array.from(altTotMap.values())
    .filter((t) => t.overOdds != null && t.underOdds != null && t.line !== total?.line)
    .map((t) => ({ ...t, ...devigTotal(t.overOdds as number, t.underOdds as number) }))
    .sort((a, b) => a.line - b.line);

  return {
    gameId: event.id,
    league,
    gameDate: event.commence_time,
    home: { name: event.home_team, abbr: event.home_team.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase() },
    away: { name: event.away_team, abbr: event.away_team.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase() },
    estimatedStatus: estimateStatus(new Date(event.commence_time), new Date()),
    moneyline: homeOdds !== null && awayOdds !== null ? { homeOdds, awayOdds, homeFair, awayFair, prevHomeFair: null, prevAwayFair: null } : null,
    runLine,
    total,
    altRunLines,
    altTotals,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Provider class ───────────────────────────────────────────────────────────

export class IntlOddsProvider {
  public readonly name: string;
  private readonly apiKey: string | null;

  constructor(apiKey: string | null) {
    this.apiKey = apiKey;
    this.name = apiKey
      ? "TheOddsApi (NPB + KBO)"
      : "Mock NPB/KBO (synthetic, non-scraped demo data)";
  }

  async getGames(date: Date = new Date()): Promise<IntlGameRecord[]> {
    if (!this.apiKey) return mockGames(date);

    const [npbEvents, kboEvents] = await Promise.allSettled([
      fetchLeagueOdds(this.apiKey, "baseball_npb"),
      fetchLeagueOdds(this.apiKey, "baseball_kbo"),
    ]);

    const games: IntlGameRecord[] = [];
    if (npbEvents.status === "fulfilled") {
      games.push(...npbEvents.value.map((e) => parseOddsEvent(e, "NPB")));
    } else {
      console.warn("[intl] NPB odds fetch failed:", npbEvents.reason);
    }
    if (kboEvents.status === "fulfilled") {
      games.push(...kboEvents.value.map((e) => parseOddsEvent(e, "KBO")));
    } else {
      console.warn("[intl] KBO odds fetch failed:", kboEvents.reason);
    }

    // Fallback to mock if API returned nothing (common on free tier if leagues aren't listed)
    if (games.length === 0) {
      console.warn("[intl] API returned no NPB/KBO games — using mock data");
      return mockGames(date);
    }

    return games.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());
  }
}

import { useEffect, useState } from "react";
import { fetchGames, fetchIntlGames, fetchWnbaGames, fetchNflGames, fetchNbaGames } from "./api";
import type { GameRecord, IntlGameRecord, WnbaGameRecord, NflGameRecord, NbaGameRecord } from "./types";
import { GameCard } from "./GameCard";
import { IntlGameCard } from "./IntlGameCard";
import { WnbaGameCard } from "./WnbaGameCard";
import { NflGameCard } from "./NflGameCard";
import { NbaGameCard } from "./NbaGameCard";

const POLL_MS = 30_000;

type Tab = "mlb" | "intl" | "wnba" | "nfl" | "nba";
type SubTab = "upcoming" | "live" | "final";

/** Normalizes the various per-sport status fields (GameRecord/WnbaGameRecord/
 *  NflGameRecord use "status"; IntlGameRecord uses "estimatedStatus") into
 *  the three buckets this sub-tab bar cares about. The rare "Unknown" status
 *  is bucketed with "upcoming" rather than silently dropped. */
function subTabOf(status: string): SubTab {
  if (status === "Final") return "final";
  if (status === "Live") return "live";
  return "upcoming"; // "Preview" and "Unknown"
}
function bySubTab<T>(games: T[], status: (g: T) => string, subTab: SubTab): T[] {
  return games.filter((g) => subTabOf(status(g)) === subTab);
}

export function App() {
  // Deep-linkable tabs: read initial tab from URL hash (#mlb / #intl / #wnba),
  // and keep the hash in sync on switch so a tab can be bookmarked/shared/screenshotted.
  const [tab, setTab] = useState<Tab>(() => {
    const h = window.location.hash.slice(1);
    return h === "intl" || h === "wnba" || h === "nfl" || h === "nba" ? h : "mlb";
  });
  function selectTab(t: Tab) {
    setTab(t);
    window.location.hash = t;
  }

  // Shared across all four sport tabs: "live" = Preview + Live (i.e. not
  // finished yet), "final" = Final. Switching main tabs keeps whichever
  // sub-tab was selected, since the same question ("what's still live/
  // upcoming?") applies no matter which sport you're looking at.
  const [subTab, setSubTab] = useState<SubTab>("upcoming");

  // ── MLB state ────────────────────────────────────────────────────────────────
  const [games, setGames] = useState<GameRecord[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // ── Intl state ───────────────────────────────────────────────────────────────
  const [intlGames, setIntlGames] = useState<IntlGameRecord[]>([]);
  const [intlProvider, setIntlProvider] = useState<string>("");
  const [intlError, setIntlError] = useState<string | null>(null);
  const [intlRefreshed, setIntlRefreshed] = useState<Date | null>(null);

  // ── WNBA state ───────────────────────────────────────────────────────────────
  const [wnbaGames, setWnbaGames] = useState<WnbaGameRecord[]>([]);
  const [wnbaProvider, setWnbaProvider] = useState<string>("");
  const [wnbaError, setWnbaError] = useState<string | null>(null);
  const [wnbaRefreshed, setWnbaRefreshed] = useState<Date | null>(null);

  // ── NFL state ────────────────────────────────────────────────────────────────
  const [nflGames, setNflGames] = useState<NflGameRecord[]>([]);
  const [nflProvider, setNflProvider] = useState<string>("");
  const [nflError, setNflError] = useState<string | null>(null);
  const [nflRefreshed, setNflRefreshed] = useState<Date | null>(null);

  // ── NBA state ────────────────────────────────────────────────────────────────
  const [nbaGames, setNbaGames] = useState<NbaGameRecord[]>([]);
  const [nbaProvider, setNbaProvider] = useState<string>("");
  const [nbaError, setNbaError] = useState<string | null>(null);
  const [nbaRefreshed, setNbaRefreshed] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMlb() {
      try {
        const data = await fetchGames();
        if (cancelled) return;
        setGames(data.games);
        setProvider(data.provider);
        setLastRefreshed(new Date());
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load games");
      }
    }
    loadMlb();
    const t = setInterval(loadMlb, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadIntl() {
      try {
        const data = await fetchIntlGames();
        if (cancelled) return;
        setIntlGames(data.games);
        setIntlProvider(data.provider);
        setIntlRefreshed(new Date());
        setIntlError(null);
      } catch (err) {
        if (!cancelled) setIntlError(err instanceof Error ? err.message : "Failed to load intl games");
      }
    }
    loadIntl();
    const t = setInterval(loadIntl, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWnba() {
      try {
        const data = await fetchWnbaGames();
        if (cancelled) return;
        setWnbaGames(data.games);
        setWnbaProvider(data.provider);
        setWnbaRefreshed(new Date());
        setWnbaError(null);
      } catch (err) {
        if (!cancelled) setWnbaError(err instanceof Error ? err.message : "Failed to load WNBA games");
      }
    }
    loadWnba();
    const t = setInterval(loadWnba, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadNfl() {
      try {
        const data = await fetchNflGames();
        if (cancelled) return;
        setNflGames(data.games);
        setNflProvider(data.provider);
        setNflRefreshed(new Date());
        setNflError(null);
      } catch (err) {
        if (!cancelled) setNflError(err instanceof Error ? err.message : "Failed to load NFL games");
      }
    }
    loadNfl();
    const t = setInterval(loadNfl, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadNba() {
      try {
        const data = await fetchNbaGames();
        if (cancelled) return;
        setNbaGames(data.games);
        setNbaProvider(data.provider);
        setNbaRefreshed(new Date());
        setNbaError(null);
      } catch (err) {
        if (!cancelled) setNbaError(err instanceof Error ? err.message : "Failed to load NBA games");
      }
    }
    loadNba();
    const t = setInterval(loadNba, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const npbGames = intlGames.filter((g) => g.league === "NPB");
  const kboGames = intlGames.filter((g) => g.league === "KBO");

  // Filtered-by-subtab lists actually rendered below. Each sport's raw list
  // stays intact (used for the main tab's game-count badge); only the view
  // is split into "live/upcoming" vs "final".
  const shownGames = bySubTab(games, (g) => g.status, subTab);
  const shownNpbGames = bySubTab(npbGames, (g) => g.estimatedStatus, subTab);
  const shownKboGames = bySubTab(kboGames, (g) => g.estimatedStatus, subTab);
  const shownWnbaGames = bySubTab(wnbaGames, (g) => g.status, subTab);
  const shownNflGames = bySubTab(nflGames, (g) => g.status, subTab);
  const shownNbaGames = bySubTab(nbaGames, (g) => g.status, subTab);

  // Live/Final counts for the currently active main tab, shown on the
  // sub-tab buttons so you know what's behind each one before clicking.
  const activeRawGames =
    tab === "mlb" ? games.map((g) => g.status)
    : tab === "intl" ? intlGames.map((g) => g.estimatedStatus)
    : tab === "wnba" ? wnbaGames.map((g) => g.status)
    : tab === "nfl" ? nflGames.map((g) => g.status)
    : nbaGames.map((g) => g.status);
  const upcomingCount = activeRawGames.filter((st) => subTabOf(st) === "upcoming").length;
  const liveCount = activeRawGames.filter((st) => subTabOf(st) === "live").length;
  const finalCount = activeRawGames.filter((st) => subTabOf(st) === "final").length;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Baseball Odds Dashboard</h1>
        <div className="app-meta">
          <span>
            {tab === "mlb" ? provider || "loading..."
              : tab === "intl" ? intlProvider || "loading..."
              : tab === "wnba" ? wnbaProvider || "loading..."
              : tab === "nfl" ? nflProvider || "loading..."
              : nbaProvider || "loading..."}
          </span>
          {tab === "mlb" && lastRefreshed && (
            <span>Last refreshed: {lastRefreshed.toLocaleTimeString()}</span>
          )}
          {tab === "intl" && intlRefreshed && (
            <span>Last refreshed: {intlRefreshed.toLocaleTimeString()}</span>
          )}
          {tab === "wnba" && wnbaRefreshed && (
            <span>Last refreshed: {wnbaRefreshed.toLocaleTimeString()}</span>
          )}
          {tab === "nfl" && nflRefreshed && (
            <span>Last refreshed: {nflRefreshed.toLocaleTimeString()}</span>
          )}
          {tab === "nba" && nbaRefreshed && (
            <span>Last refreshed: {nbaRefreshed.toLocaleTimeString()}</span>
          )}
        </div>
      </header>

      {/* Tab bar */}
      <nav className="tab-bar">
        <button
          className={`tab-btn ${tab === "mlb" ? "tab-btn--active" : ""}`}
          onClick={() => selectTab("mlb")}
        >
          MLB
        </button>
        <button
          className={`tab-btn ${tab === "intl" ? "tab-btn--active" : ""}`}
          onClick={() => selectTab("intl")}
        >
          International
          {intlGames.length > 0 && (
            <span className="tab-count">
              {npbGames.length} NPB · {kboGames.length} KBO
            </span>
          )}
        </button>
        <button
          className={`tab-btn ${tab === "wnba" ? "tab-btn--active" : ""}`}
          onClick={() => selectTab("wnba")}
        >
          WNBA
          {wnbaGames.length > 0 && (
            <span className="tab-count">{wnbaGames.length} games</span>
          )}
        </button>
        <button
          className={`tab-btn ${tab === "nfl" ? "tab-btn--active" : ""}`}
          onClick={() => selectTab("nfl")}
        >
          NFL
          {nflGames.length > 0 && (
            <span className="tab-count">{nflGames.length} games</span>
          )}
        </button>
        <button
          className={`tab-btn ${tab === "nba" ? "tab-btn--active" : ""}`}
          onClick={() => selectTab("nba")}
        >
          NBA
          {nbaGames.length > 0 && (
            <span className="tab-count">{nbaGames.length} games</span>
          )}
        </button>
      </nav>

      {/* Sub-tab bar: upcoming / live / final, applies to whichever sport tab is active */}
      <nav className="subtab-bar">
        <button
          className={`subtab-btn ${subTab === "upcoming" ? "subtab-btn--active" : ""}`}
          onClick={() => setSubTab("upcoming")}
        >
          Upcoming
          <span className="tab-count">{upcomingCount}</span>
        </button>
        <button
          className={`subtab-btn ${subTab === "live" ? "subtab-btn--active" : ""}`}
          onClick={() => setSubTab("live")}
        >
          Live
          <span className="tab-count">{liveCount}</span>
        </button>
        <button
          className={`subtab-btn ${subTab === "final" ? "subtab-btn--active" : ""}`}
          onClick={() => setSubTab("final")}
        >
          Final
          <span className="tab-count">{finalCount}</span>
        </button>
      </nav>

      {/* MLB tab */}
      {tab === "mlb" && (
        <>
          {error && <div className="error-banner">Error loading games: {error}</div>}
          {games.length === 0 && !error && <div className="loading">Loading today&apos;s games...</div>}
          {games.length > 0 && shownGames.length === 0 && <div className="loading">No {subTab === "final" ? "finished" : subTab === "live" ? "live" : "upcoming"} games.</div>}
          <main className="game-grid">
            {shownGames.map((g) => <GameCard key={g.gamePk} game={g} />)}
          </main>
        </>
      )}

      {/* International tab */}
      {tab === "intl" && (
        <>
          {intlError && <div className="error-banner">Error loading intl games: {intlError}</div>}
          {intlGames.length === 0 && !intlError && <div className="loading">Loading international games...</div>}
          {intlGames.length > 0 && shownNpbGames.length === 0 && shownKboGames.length === 0 && (
            <div className="loading">No {subTab === "final" ? "finished" : subTab === "live" ? "live" : "upcoming"} games.</div>
          )}

          {shownNpbGames.length > 0 && (
            <section className="intl-league-section">
              <h2 className="intl-league-heading">NPB — Japan</h2>
              <div className="game-grid">
                {shownNpbGames.map((g) => <IntlGameCard key={g.gameId} game={g} />)}
              </div>
            </section>
          )}
          {shownKboGames.length > 0 && (
            <section className="intl-league-section">
              <h2 className="intl-league-heading">KBO — South Korea</h2>
              <div className="game-grid">
                {shownKboGames.map((g) => <IntlGameCard key={g.gameId} game={g} />)}
              </div>
            </section>
          )}
        </>
      )}

      {/* WNBA tab */}
      {tab === "wnba" && (
        <>
          {wnbaError && <div className="error-banner">Error loading WNBA games: {wnbaError}</div>}
          {wnbaGames.length === 0 && !wnbaError && <div className="loading">Loading WNBA games...</div>}
          {wnbaGames.length > 0 && shownWnbaGames.length === 0 && <div className="loading">No {subTab === "final" ? "finished" : subTab === "live" ? "live" : "upcoming"} games.</div>}
          <main className="game-grid">
            {shownWnbaGames.map((g) => <WnbaGameCard key={g.gameId} game={g} />)}
          </main>
        </>
      )}

      {/* NFL tab */}
      {tab === "nfl" && (
        <>
          {nflError && <div className="error-banner">Error loading NFL games: {nflError}</div>}
          {nflGames.length === 0 && !nflError && <div className="loading">Loading NFL games...</div>}
          {nflGames.length > 0 && shownNflGames.length === 0 && <div className="loading">No {subTab === "final" ? "finished" : subTab === "live" ? "live" : "upcoming"} games.</div>}
          <main className="game-grid">
            {shownNflGames.map((g) => <NflGameCard key={g.gameId} game={g} />)}
          </main>
        </>
      )}

      {/* NBA tab */}
      {tab === "nba" && (
        <>
          {nbaError && <div className="error-banner">Error loading NBA games: {nbaError}</div>}
          {nbaGames.length === 0 && !nbaError && <div className="loading">Loading NBA games...</div>}
          {nbaGames.length > 0 && shownNbaGames.length === 0 && <div className="loading">No {subTab === "final" ? "finished" : subTab === "live" ? "live" : "upcoming"} games.</div>}
          <main className="game-grid">
            {shownNbaGames.map((g) => <NbaGameCard key={g.gameId} game={g} />)}
          </main>
        </>
      )}

      <footer className="app-footer">
        Implied probabilities are de-vigged so home + away sum to 100%.
        Consensus is an equal-weighted average of fair probabilities.
        Alt run lines and alt totals show alternate spread/total options from the same market.
        WNBA and NBA player projections use each player&apos;s real season per-game average
        (ESPN); probability is the Poisson chance of meeting or beating that average tonight.
        WNBA/NBA matchup pairings are a synthetic daily slate (no public schedule API is reachable
        from this network); rosters and season stats are real. NFL schedule/scores are real (ESPN);
        all moneyline odds follow whatever ODDS_PROVIDER is configured (mock or The Odds API).
        MLB and NFL show each hot player's real live/final stat line next to their projection
        (green badge). Since WNBA/NBA matchups are synthetic, their "stat so far tonight" badges
        (amber, labeled "sim") are simulated progress toward the real season average, not live data.
      </footer>
    </div>
  );
}

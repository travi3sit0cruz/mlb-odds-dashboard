import type { GamesResponse, IntlGamesResponse, WnbaGamesResponse, NflGamesResponse, NbaGamesResponse } from "./types";

// Empty string = same-origin, so this works whether served by the backend (port 4000)
// or the Vite dev server (which proxies /api to port 4000 via vite.config.ts).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export async function fetchGames(): Promise<GamesResponse> {
  const res = await fetch(`${API_BASE_URL}/api/games`);
  if (!res.ok) throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchIntlGames(): Promise<IntlGamesResponse> {
  const res = await fetch(`${API_BASE_URL}/api/intl-games`);
  if (!res.ok) throw new Error(`Intl API request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchWnbaGames(): Promise<WnbaGamesResponse> {
  const res = await fetch(`${API_BASE_URL}/api/wnba-games`);
  if (!res.ok) throw new Error(`WNBA API request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchNflGames(): Promise<NflGamesResponse> {
  const res = await fetch(`${API_BASE_URL}/api/nfl-games`);
  if (!res.ok) throw new Error(`NFL API request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchNbaGames(): Promise<NbaGamesResponse> {
  const res = await fetch(`${API_BASE_URL}/api/nba-games`);
  if (!res.ok) throw new Error(`NBA API request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

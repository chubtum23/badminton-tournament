import type { Settings } from './types';

/** A player as the leaderboard needs them: the person plus the team they played for. */
export interface RatedPlayer {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
}

/** One rating the organiser gave, flattened out of its game. */
export interface RatingEntry {
  playerId: string;
  rating: number;
}

export interface PlayerRatingRow {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  gamesRated: number;
  /** null until the player has been rated at least once. */
  average: number | null;
  /** Dense rank over the average as displayed; null while the player has no average. */
  rank: number | null;
}

export interface TeamRatingRow {
  teamId: string;
  name: string;
  playersRated: number;
  average: number | null;
  rank: number | null;
}

/** One decimal place, which is the whole precision of the scale: nothing stores more than this. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * What to put in the box before the organiser touches it, from the margin of that game alone.
 *
 * 5.5 is the exact middle of 1-10, so a level game suggests the middle to all four players and the
 * two sides are always symmetrical about it. The margin is measured against the game's own target
 * score, so a knockout played to 21 scales the same way a pool game to 15 does, and a game that ran
 * past its target (win by two) is clamped rather than pushed off the end of the scale.
 */
export function suggestRating(settings: Settings, own: number, opp: number): number {
  const d = clamp((own - opp) / settings.pointsPerGame, -1, 1);
  return round1(clamp(5.5 + 4 * d, 1, 10));
}

/**
 * Dense ranks down a list already in display order: equal averages share a number and the next
 * distinct average takes the next one. Rows with no average are never ranked.
 */
function denseRank<T extends { average: number | null }>(rows: T[]): (T & { rank: number | null })[] {
  let rank = 0;
  let previous: number | null = null;
  return rows.map((row) => {
    if (row.average === null) return { ...row, rank: null };
    if (row.average !== previous) { rank += 1; previous = row.average; }
    return { ...row, rank };
  });
}

/** Rated rows first by average descending, then by name; everyone unrated after them, by name. */
function byAverageThenName(a: { average: number | null; name: string }, b: { average: number | null; name: string }): number {
  if (a.average === null && b.average === null) return a.name.localeCompare(b.name);
  if (a.average === null) return 1;
  if (b.average === null) return -1;
  if (a.average !== b.average) return b.average - a.average;
  return a.name.localeCompare(b.name);
}

/**
 * Every player of the tournament with the mean of their ratings. Raw averages, deliberately: a
 * player rated once sits wherever that one rating puts them, and the `gamesRated` column beside it
 * is what tells the reader how much to trust the number.
 *
 * Ranks compare the average as displayed (one decimal), so two players both showing 7.4 always
 * share a rank even though the underlying means differ in the third decimal.
 */
export function playerRatings(players: readonly RatedPlayer[], ratings: readonly RatingEntry[]): PlayerRatingRow[] {
  const byPlayer = new Map<string, number[]>();
  for (const r of ratings) {
    const list = byPlayer.get(r.playerId);
    if (list) list.push(r.rating); else byPlayer.set(r.playerId, [r.rating]);
  }
  const rows = players.map((p) => {
    const mine = byPlayer.get(p.id) ?? [];
    return {
      playerId: p.id, name: p.name, teamId: p.teamId, teamName: p.teamName,
      gamesRated: mine.length,
      average: mine.length === 0 ? null : round1(mine.reduce((s, v) => s + v, 0) / mine.length),
    };
  });
  return denseRank(rows.sort(byAverageThenName));
}

/**
 * A team scores the mean of its players' averages, so a substitute who played one game counts as
 * much as someone who played four. A player nobody has rated is left out of the mean rather than
 * counted as a zero, which would drag a team down for a game that was never played.
 */
export function teamRatings(rows: readonly PlayerRatingRow[]): TeamRatingRow[] {
  const teams = new Map<string, { teamId: string; name: string; averages: number[] }>();
  for (const r of rows) {
    const team = teams.get(r.teamId) ?? { teamId: r.teamId, name: r.teamName, averages: [] };
    if (r.average !== null) team.averages.push(r.average);
    teams.set(r.teamId, team);
  }
  const out = [...teams.values()].map((t) => ({
    teamId: t.teamId, name: t.name, playersRated: t.averages.length,
    average: t.averages.length === 0 ? null : round1(t.averages.reduce((s, v) => s + v, 0) / t.averages.length),
  }));
  return denseRank(out.sort(byAverageThenName));
}

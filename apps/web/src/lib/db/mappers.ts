import type { Game, Match, Settings, Stage, TeamRef } from '@tournament/core';
import type { GameRow, MatchRow, ScoredGameRow, TeamRow, TournamentRow } from './types';

export function rowToMatch(r: MatchRow): Match {
  return {
    id: r.id, stage: r.stage, poolId: r.pool_id, round: r.round, slot: r.slot,
    teamAId: r.team_a_id, teamBId: r.team_b_id, status: r.status,
    winnerId: r.winner_id, decidedBy: r.decided_by, nextMatchId: r.next_match_id, nextMatchSide: r.next_match_side,
  };
}

/**
 * `Match` in @tournament/core has no timestamps, so `finished_at` is owned by the caller (see
 * enterResult) and deliberately left out of the mapped row. The court and the clock are not here
 * at all any more: they belong to the individual game rows.
 */
export function matchToRow(m: Match, tournamentId: string): Omit<MatchRow, 'finished_at'> {
  return {
    id: m.id, tournament_id: tournamentId, stage: m.stage, pool_id: m.poolId, round: m.round, slot: m.slot,
    team_a_id: m.teamAId, team_b_id: m.teamBId, status: m.status,
    winner_id: m.winnerId, decided_by: m.decidedBy, next_match_id: m.nextMatchId, next_match_side: m.nextMatchSide,
  };
}

export function rowToGame(r: ScoredGameRow): Game {
  return { gameNo: r.game_no, scoreA: r.score_a, scoreB: r.score_b, timeExpired: r.time_expired };
}

/** The name the organiser gave this game, e.g. "Men's doubles". */
export function gameLabel(t: Pick<TournamentRow, 'game_labels'>, gameNo: number): string {
  return t.game_labels[gameNo - 1] ?? `Game ${gameNo}`;
}

/** Game 3 of a meeting is the men's doubles, and a playoff's only game is played by that pair. */
const MENS_DOUBLES_GAME = 3;

/** Which game of a meeting decides who is on court for this slot: a playoff's game 1 is the men's pair. */
export function pairingGameNo(stage: Stage, gameNo: number): number {
  return stage === 'playoff' ? MENS_DOUBLES_GAME : gameNo;
}

/** The slot's name as the organiser sees it, e.g. "Men's doubles playoff". */
export function stageGameLabel(t: Pick<TournamentRow, 'game_labels'>, stage: Stage, gameNo: number): string {
  return stage === 'playoff' ? `${gameLabel(t, MENS_DOUBLES_GAME)} playoff` : gameLabel(t, gameNo);
}

/** The empty game rows a newly created match starts with, one per game of the meeting. */
export function slotRowsFor(matchId: string, gamesPerMatch: number): { match_id: string; game_no: number }[] {
  return Array.from({ length: gamesPerMatch }, (_, i) => ({ match_id: matchId, game_no: i + 1 }));
}

/** Only the games that have actually been scored, because that is what the rules package consumes. */
export function gamesByMatch(rows: readonly GameRow[]): Record<string, Game[]> {
  const out: Record<string, Game[]> = {};
  for (const r of rows) {
    if (r.score_a === null || r.score_b === null) continue; // an unplayed slot is not a game yet
    (out[r.match_id] ??= []).push({ gameNo: r.game_no, scoreA: r.score_a, scoreB: r.score_b, timeExpired: r.time_expired });
  }
  for (const list of Object.values(out)) list.sort((x, y) => x.gameNo - y.gameNo);
  return out;
}

/**
 * The rules that apply to one stage. Pool and playoff matches use the tournament's pool columns;
 * knockout matches use the `ko_*` overrides column by column, falling back to the pool value where
 * an override is null. `ko_time_cap_minutes` needs a third state, so 0 is the stored sentinel for
 * "the knockout has no clock" (null there still means "same as the pool stage").
 *
 * `ko_max_points` has no such sentinel: null means "same as the pool stage", and there is no value
 * that means "the knockout has no cap". A knockout that must drop a cap the pool stage sets would
 * need a future column (say `ko_max_points_none boolean`) or the same 0-sentinel treatment.
 */
export function settingsFor(t: TournamentRow, stage: Stage): Settings {
  const pool: Settings = {
    gamesPerMatch: t.games_per_match, pointsPerGame: t.points_per_game,
    winByTwo: t.win_by_two, maxPoints: t.max_points, timeCapMinutes: t.time_cap_minutes,
    playAllGames: t.play_all_games,
  };
  // A playoff settles a tie with one men's doubles game, not a whole meeting.
  if (stage === 'playoff') return { ...pool, gamesPerMatch: 1, playAllGames: false };
  if (stage !== 'knockout') return pool;
  return {
    gamesPerMatch: t.ko_games_per_match ?? pool.gamesPerMatch,
    pointsPerGame: t.ko_points_per_game ?? pool.pointsPerGame,
    winByTwo: t.ko_win_by_two ?? pool.winByTwo,
    maxPoints: t.ko_max_points ?? pool.maxPoints,
    timeCapMinutes: t.ko_time_cap_minutes === null ? pool.timeCapMinutes : t.ko_time_cap_minutes === 0 ? null : t.ko_time_cap_minutes,
    // Whether every game is played is a format decision for the whole event, so there is no
    // knockout override column for it.
    playAllGames: pool.playAllGames,
  };
}

export function teamRefs(teams: readonly TeamRow[]): TeamRef[] {
  return teams.map((t) => ({ id: t.id, name: t.name }));
}

import type { Game, Match, Settings, Stage, TeamRef } from '@tournament/core';
import type { GameRow, MatchRow, TeamRow, TournamentRow } from './types';

export function rowToMatch(r: MatchRow): Match {
  return {
    id: r.id, stage: r.stage, poolId: r.pool_id, round: r.round, slot: r.slot,
    teamAId: r.team_a_id, teamBId: r.team_b_id, court: r.court, status: r.status,
    winnerId: r.winner_id, decidedBy: r.decided_by, nextMatchId: r.next_match_id, nextMatchSide: r.next_match_side,
  };
}

/**
 * `Match` in @tournament/core has no timestamps, so `started_at` and `finished_at` are owned by
 * the caller (see enterResult) and deliberately left out of the mapped row.
 */
export function matchToRow(m: Match, tournamentId: string): Omit<MatchRow, 'finished_at' | 'started_at'> {
  return {
    id: m.id, tournament_id: tournamentId, stage: m.stage, pool_id: m.poolId, round: m.round, slot: m.slot,
    team_a_id: m.teamAId, team_b_id: m.teamBId, court: m.court, status: m.status,
    winner_id: m.winnerId, decided_by: m.decidedBy, next_match_id: m.nextMatchId, next_match_side: m.nextMatchSide,
  };
}

export function rowToGame(r: GameRow): Game {
  return { gameNo: r.game_no, scoreA: r.score_a, scoreB: r.score_b, timeExpired: r.time_expired };
}

export function gamesByMatch(rows: readonly GameRow[]): Record<string, Game[]> {
  const out: Record<string, Game[]> = {};
  for (const r of rows) (out[r.match_id] ??= []).push(rowToGame(r));
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
  };
  if (stage !== 'knockout') return pool;
  return {
    gamesPerMatch: t.ko_games_per_match ?? pool.gamesPerMatch,
    pointsPerGame: t.ko_points_per_game ?? pool.pointsPerGame,
    winByTwo: t.ko_win_by_two ?? pool.winByTwo,
    maxPoints: t.ko_max_points ?? pool.maxPoints,
    timeCapMinutes: t.ko_time_cap_minutes === null ? pool.timeCapMinutes : t.ko_time_cap_minutes === 0 ? null : t.ko_time_cap_minutes,
  };
}

export function teamRefs(teams: readonly TeamRow[]): TeamRef[] {
  return teams.map((t) => ({ id: t.id, name: t.name }));
}

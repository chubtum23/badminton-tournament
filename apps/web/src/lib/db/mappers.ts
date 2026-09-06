import type { Game, Match, Settings, TeamRef } from '@tournament/core';
import type { GameRow, MatchRow, TeamRow, TournamentRow } from './types';

export function rowToMatch(r: MatchRow): Match {
  return {
    id: r.id, stage: r.stage, poolId: r.pool_id, round: r.round, slot: r.slot,
    teamAId: r.team_a_id, teamBId: r.team_b_id, court: r.court, status: r.status,
    winnerId: r.winner_id, nextMatchId: r.next_match_id, nextMatchSide: r.next_match_side,
  };
}

export function matchToRow(m: Match, tournamentId: string): MatchRow {
  return {
    id: m.id, tournament_id: tournamentId, stage: m.stage, pool_id: m.poolId, round: m.round, slot: m.slot,
    team_a_id: m.teamAId, team_b_id: m.teamBId, court: m.court, status: m.status,
    winner_id: m.winnerId, next_match_id: m.nextMatchId, next_match_side: m.nextMatchSide,
  };
}

export function rowToGame(r: GameRow): Game {
  return { gameNo: r.game_no, scoreA: r.score_a, scoreB: r.score_b };
}

export function gamesByMatch(rows: readonly GameRow[]): Record<string, Game[]> {
  const out: Record<string, Game[]> = {};
  for (const r of rows) (out[r.match_id] ??= []).push(rowToGame(r));
  for (const list of Object.values(out)) list.sort((x, y) => x.gameNo - y.gameNo);
  return out;
}

export function settingsFromTournament(t: TournamentRow): Settings {
  return {
    gamesPerMatch: t.games_per_match, pointsPerGame: t.points_per_game,
    winByTwo: t.win_by_two, maxPoints: t.max_points,
  };
}

export function teamRefs(teams: readonly TeamRow[]): TeamRef[] {
  return teams.map((t) => ({ id: t.id, name: t.name }));
}

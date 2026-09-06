import { describe, it, expect } from 'vitest';
import { rowToMatch, matchToRow, rowToGame, settingsFromTournament, gamesByMatch, teamRefs } from './mappers';
import type { MatchRow, TournamentRow, GameRow, TeamRow } from './types';

const row: MatchRow = {
  id: 'm1', tournament_id: 't1', stage: 'knockout', pool_id: null, round: 2, slot: 1,
  team_a_id: 'a', team_b_id: null, court: 3, status: 'live', winner_id: null,
  next_match_id: 'm9', next_match_side: 'b', finished_at: null,
};

describe('match mapping', () => {
  it('round-trips a row through the core Match type', () => {
    const m = rowToMatch(row);
    expect(m).toEqual({
      id: 'm1', stage: 'knockout', poolId: null, round: 2, slot: 1, teamAId: 'a', teamBId: null,
      court: 3, status: 'live', winnerId: null, nextMatchId: 'm9', nextMatchSide: 'b',
    });
    // matchToRow does not own finished_at (see mappers.ts), so it is absent from the mapped row.
    const { finished_at, ...withoutFinishedAt } = row;
    expect(matchToRow(m, 't1')).toEqual(withoutFinishedAt);
    expect(finished_at).toBeNull();
  });
});

describe('games', () => {
  const rows: GameRow[] = [
    { match_id: 'm1', game_no: 2, score_a: 12, score_b: 15 },
    { match_id: 'm1', game_no: 1, score_a: 15, score_b: 9 },
    { match_id: 'm2', game_no: 1, score_a: 15, score_b: 1 },
  ];
  it('maps a game row', () => {
    expect(rowToGame(rows[0]!)).toEqual({ gameNo: 2, scoreA: 12, scoreB: 15 });
  });
  it('groups games by match in game order', () => {
    const g = gamesByMatch(rows);
    expect(Object.keys(g).sort()).toEqual(['m1', 'm2']);
    expect(g['m1']!.map((x) => x.gameNo)).toEqual([1, 2]);
  });
});

describe('settings', () => {
  it('reads Settings from a tournament row', () => {
    const t = {
      games_per_match: 3, points_per_game: 15, win_by_two: true, max_points: 21,
    } as TournamentRow;
    expect(settingsFromTournament(t)).toEqual({ gamesPerMatch: 3, pointsPerGame: 15, winByTwo: true, maxPoints: 21 });
  });
});

describe('teamRefs', () => {
  it('keeps id and name only', () => {
    const teams = [{ id: 'x', name: 'Aces', tournament_id: 't', tagline: '', colour: '#000000', seed: null, pool_id: null, pool_order: 0 }] as TeamRow[];
    expect(teamRefs(teams)).toEqual([{ id: 'x', name: 'Aces' }]);
  });
});

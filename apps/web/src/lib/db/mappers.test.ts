import { describe, it, expect } from 'vitest';
import { rowToMatch, matchToRow, rowToGame, settingsFor, gamesByMatch, teamRefs } from './mappers';
import type { MatchRow, TournamentRow, GameRow, TeamRow } from './types';

const row: MatchRow = {
  id: 'm1', tournament_id: 't1', stage: 'knockout', pool_id: null, round: 2, slot: 1,
  team_a_id: 'a', team_b_id: null, court: 3, status: 'live', winner_id: null, decided_by: 'played',
  next_match_id: 'm9', next_match_side: 'b', started_at: null, finished_at: null,
};

describe('match mapping', () => {
  it('round-trips a row through the core Match type', () => {
    const m = rowToMatch(row);
    expect(m).toEqual({
      id: 'm1', stage: 'knockout', poolId: null, round: 2, slot: 1, teamAId: 'a', teamBId: null,
      court: 3, status: 'live', winnerId: null, decidedBy: 'played', nextMatchId: 'm9', nextMatchSide: 'b',
    });
    // matchToRow owns neither timestamp (see mappers.ts), so both are absent from the mapped row.
    const { finished_at, started_at, ...withoutTimestamps } = row;
    expect(matchToRow(m, 't1')).toEqual(withoutTimestamps);
    expect(finished_at).toBeNull();
    expect(started_at).toBeNull();
  });
  it('carries a non-played decision both ways', () => {
    const forfeited: MatchRow = { ...row, decided_by: 'forfeit' };
    expect(rowToMatch(forfeited).decidedBy).toBe('forfeit');
    expect(matchToRow(rowToMatch(forfeited), 't1').decided_by).toBe('forfeit');
  });
});

describe('games', () => {
  const rows: GameRow[] = [
    { match_id: 'm1', game_no: 2, score_a: 12, score_b: 15, time_expired: false },
    { match_id: 'm1', game_no: 1, score_a: 15, score_b: 9, time_expired: false },
    { match_id: 'm2', game_no: 1, score_a: 15, score_b: 1, time_expired: true },
  ];
  it('maps a game row', () => {
    expect(rowToGame(rows[0]!)).toEqual({ gameNo: 2, scoreA: 12, scoreB: 15, timeExpired: false });
  });
  it('carries time_expired', () => {
    expect(rowToGame(rows[2]!).timeExpired).toBe(true);
  });
  it('groups games by match in game order', () => {
    const g = gamesByMatch(rows);
    expect(Object.keys(g).sort()).toEqual(['m1', 'm2']);
    expect(g['m1']!.map((x) => x.gameNo)).toEqual([1, 2]);
  });
});

describe('settingsFor', () => {
  const base = {
    games_per_match: 1, points_per_game: 15, win_by_two: false, max_points: null, time_cap_minutes: 13,
    ko_games_per_match: null, ko_points_per_game: null, ko_win_by_two: null, ko_max_points: null, ko_time_cap_minutes: null,
  } as TournamentRow;

  it('uses pool values for pool and playoff, and falls back for knockout when ko_* are null', () => {
    const pool = { gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13 };
    expect(settingsFor(base, 'pool')).toEqual(pool);
    expect(settingsFor(base, 'playoff')).toEqual(pool);
    expect(settingsFor(base, 'knockout')).toEqual(pool);
  });

  it('uses ko_* for knockout when set', () => {
    // ko_time_cap_minutes stays null here, so the clock still falls back to the pool's 13.
    const t = { ...base, ko_games_per_match: 3, ko_win_by_two: true, ko_max_points: 21, ko_time_cap_minutes: null } as TournamentRow;
    expect(settingsFor(t, 'knockout')).toEqual({ gamesPerMatch: 3, pointsPerGame: 15, winByTwo: true, maxPoints: 21, timeCapMinutes: 13 });
    // the pool stage is unaffected by the knockout overrides
    expect(settingsFor(t, 'pool')).toEqual({ gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13 });
  });

  it('reads ko_time_cap_minutes 0 as "no clock" rather than "same as pool"', () => {
    const t = { ...base, ko_time_cap_minutes: 0 } as TournamentRow;
    expect(settingsFor(t, 'knockout').timeCapMinutes).toBeNull();
    expect(settingsFor({ ...base, ko_time_cap_minutes: 20 } as TournamentRow, 'knockout').timeCapMinutes).toBe(20);
  });

  it('keeps a knockout win-by-two of false distinct from "not set"', () => {
    const t = { ...base, win_by_two: true, ko_win_by_two: false } as TournamentRow;
    expect(settingsFor(t, 'knockout').winByTwo).toBe(false);
    expect(settingsFor(t, 'pool').winByTwo).toBe(true);
  });
});

describe('teamRefs', () => {
  it('keeps id and name only', () => {
    const teams = [{ id: 'x', name: 'Aces', tournament_id: 't', tagline: '', colour: '#000000', seed: null, pool_id: null, pool_order: 0, withdrawn: false, pool_rank_override: null }] as TeamRow[];
    expect(teamRefs(teams)).toEqual([{ id: 'x', name: 'Aces' }]);
  });
});

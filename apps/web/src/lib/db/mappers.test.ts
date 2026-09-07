import { describe, it, expect } from 'vitest';
import { rowToMatch, matchToRow, rowToGame, settingsFor, gamesByMatch, teamRefs, gameLabel, slotRowsFor } from './mappers';
import type { MatchRow, TournamentRow, GameRow, ScoredGameRow, TeamRow } from './types';

const row: MatchRow = {
  id: 'm1', tournament_id: 't1', stage: 'knockout', pool_id: null, round: 2, slot: 1,
  team_a_id: 'a', team_b_id: null, status: 'live', winner_id: null, decided_by: 'played',
  next_match_id: 'm9', next_match_side: 'b', finished_at: null,
};

describe('match mapping', () => {
  it('round-trips a row through the core Match type', () => {
    const m = rowToMatch(row);
    expect(m).toEqual({
      id: 'm1', stage: 'knockout', poolId: null, round: 2, slot: 1, teamAId: 'a', teamBId: null,
      status: 'live', winnerId: null, decidedBy: 'played', nextMatchId: 'm9', nextMatchSide: 'b',
    });
    // The court and the clock now belong to the individual game rows; matchToRow still does not
    // own finished_at, which enterResult sets.
    const { finished_at, ...withoutFinished } = row;
    expect(matchToRow(m, 't1')).toEqual(withoutFinished);
    expect(finished_at).toBeNull();
  });
  it('carries a non-played decision both ways', () => {
    const forfeited: MatchRow = { ...row, decided_by: 'forfeit' };
    expect(rowToMatch(forfeited).decidedBy).toBe('forfeit');
    expect(matchToRow(rowToMatch(forfeited), 't1').decided_by).toBe('forfeit');
  });
});

describe('games', () => {
  /** The scheduling columns every game row now carries, unscheduled. */
  const unscheduled = { court: null, started_at: null, paused_at: null, paused_ms: 0 };
  const rows: GameRow[] = [
    { match_id: 'm1', game_no: 2, score_a: 12, score_b: 15, time_expired: false, ...unscheduled },
    { match_id: 'm1', game_no: 1, score_a: 15, score_b: 9, time_expired: false, ...unscheduled },
    { match_id: 'm2', game_no: 1, score_a: 15, score_b: 1, time_expired: true, ...unscheduled },
  ];
  it('maps a game row', () => {
    expect(rowToGame(rows[0] as ScoredGameRow)).toEqual({ gameNo: 2, scoreA: 12, scoreB: 15, timeExpired: false });
  });
  it('carries time_expired', () => {
    expect(rowToGame(rows[2] as ScoredGameRow).timeExpired).toBe(true);
  });
  it('groups games by match in game order', () => {
    const g = gamesByMatch(rows);
    expect(Object.keys(g).sort()).toEqual(['m1', 'm2']);
    expect(g['m1']!.map((x) => x.gameNo)).toEqual([1, 2]);
  });
  it('leaves out slots nobody has played yet', () => {
    const slot: GameRow = { match_id: 'm3', game_no: 1, score_a: null, score_b: null, time_expired: false, ...unscheduled };
    const g = gamesByMatch([...rows, slot]);
    expect(Object.keys(g).sort()).toEqual(['m1', 'm2']);
  });
});

describe('gameLabel', () => {
  const t = { game_labels: ['Mixed doubles #1', 'Mixed doubles #2', "Men's doubles"] } as TournamentRow;
  it('names each game from the tournament', () => {
    expect(gameLabel(t, 1)).toBe('Mixed doubles #1');
    expect(gameLabel(t, 3)).toBe("Men's doubles");
  });
  it('falls back when the list is shorter than the match', () => {
    expect(gameLabel({ game_labels: [] } as unknown as TournamentRow, 2)).toBe('Game 2');
  });
});

describe('slotRowsFor', () => {
  it('makes one empty slot per game', () => {
    expect(slotRowsFor('m1', 3)).toEqual([
      { match_id: 'm1', game_no: 1 }, { match_id: 'm1', game_no: 2 }, { match_id: 'm1', game_no: 3 },
    ]);
  });
});

describe('settingsFor', () => {
  const base = {
    games_per_match: 1, points_per_game: 15, win_by_two: false, max_points: null, time_cap_minutes: 13,
    play_all_games: true,
    ko_games_per_match: null, ko_points_per_game: null, ko_win_by_two: null, ko_max_points: null, ko_time_cap_minutes: null,
  } as TournamentRow;

  it('uses pool values for pool and playoff, and falls back for knockout when ko_* are null', () => {
    const pool = { gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13, playAllGames: true };
    expect(settingsFor(base, 'pool')).toEqual(pool);
    expect(settingsFor(base, 'playoff')).toEqual(pool);
    expect(settingsFor(base, 'knockout')).toEqual(pool);
  });

  it('uses ko_* for knockout when set', () => {
    // ko_time_cap_minutes stays null here, so the clock still falls back to the pool's 13.
    const t = { ...base, ko_games_per_match: 3, ko_win_by_two: true, ko_max_points: 21, ko_time_cap_minutes: null } as TournamentRow;
    expect(settingsFor(t, 'knockout')).toEqual({ gamesPerMatch: 3, pointsPerGame: 15, winByTwo: true, maxPoints: 21, timeCapMinutes: 13, playAllGames: true });
    // the pool stage is unaffected by the knockout overrides
    expect(settingsFor(t, 'pool')).toEqual({ gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13, playAllGames: true });
  });

  it('reads ko_time_cap_minutes 0 as "no clock" rather than "same as pool"', () => {
    const t = { ...base, ko_time_cap_minutes: 0 } as TournamentRow;
    expect(settingsFor(t, 'knockout').timeCapMinutes).toBeNull();
    expect(settingsFor({ ...base, ko_time_cap_minutes: 20 } as TournamentRow, 'knockout').timeCapMinutes).toBe(20);
  });

  it('carries play_all_games into every stage; the knockout has no override', () => {
    const off = { ...base, play_all_games: false } as TournamentRow;
    expect(settingsFor(off, 'pool').playAllGames).toBe(false);
    expect(settingsFor(off, 'playoff').playAllGames).toBe(false);
    expect(settingsFor(off, 'knockout').playAllGames).toBe(false);
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

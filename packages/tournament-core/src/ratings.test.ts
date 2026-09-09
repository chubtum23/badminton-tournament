import { describe, it, expect } from 'vitest';
import { BADMINTON_DEFAULTS } from './types';
import { playerRatings, round1, suggestRating, teamRatings, type RatedPlayer } from './ratings';

const S = BADMINTON_DEFAULTS; // 15 points a game

describe('suggestRating', () => {
  it('suggests the middle of the scale for a level game', () => {
    expect(suggestRating(S, 10, 10)).toBe(5.5);
  });

  it('matches the worked examples in the spec', () => {
    expect(suggestRating(S, 15, 13)).toBe(6);
    expect(suggestRating(S, 13, 15)).toBe(5);
    expect(suggestRating(S, 15, 9)).toBe(7.1);
    expect(suggestRating(S, 9, 15)).toBe(3.9);
    expect(suggestRating(S, 15, 3)).toBe(8.7);
    expect(suggestRating(S, 3, 15)).toBe(2.3);
    expect(suggestRating(S, 15, 0)).toBe(9.5);
    expect(suggestRating(S, 0, 15)).toBe(1.5);
  });

  it('clamps a margin wider than a whole game', () => {
    // A game that ran past pointsPerGame (win by two) cannot push the suggestion past its ends.
    expect(suggestRating(S, 30, 0)).toBe(9.5);
    expect(suggestRating(S, 0, 30)).toBe(1.5);
  });

  it('scales with the stage settings rather than a fixed 15', () => {
    const ko = { ...S, pointsPerGame: 21 };
    expect(suggestRating(ko, 21, 0)).toBe(9.5);
    expect(suggestRating(ko, 21, 15)).toBe(6.6); // 6/21 = 0.2857 -> 5.5 + 1.143
  });

  it('always returns one decimal place', () => {
    expect(round1(7.249)).toBe(7.2);
    expect(round1(7.25)).toBe(7.3);
    expect(Number.isInteger(suggestRating(S, 15, 5) * 10)).toBe(true);
  });
});

const PLAYERS: RatedPlayer[] = [
  { id: 'p1', name: 'Ana', teamId: 't1', teamName: 'Alpha' },
  { id: 'p2', name: 'Ben', teamId: 't1', teamName: 'Alpha' },
  { id: 'p3', name: 'Cara', teamId: 't1', teamName: 'Alpha' },
  { id: 'p4', name: 'Dan', teamId: 't2', teamName: 'Bravo' },
];

describe('playerRatings', () => {
  it('averages a player over every game they were rated in', () => {
    const rows = playerRatings(PLAYERS, [
      { playerId: 'p1', rating: 8 }, { playerId: 'p1', rating: 7 }, { playerId: 'p1', rating: 6 },
    ]);
    const ana = rows.find((r) => r.playerId === 'p1')!;
    expect(ana.gamesRated).toBe(3);
    expect(ana.average).toBe(7);
    expect(ana.rank).toBe(1);
  });

  it('keeps one decimal place on the average', () => {
    const rows = playerRatings(PLAYERS, [{ playerId: 'p1', rating: 8 }, { playerId: 'p1', rating: 7.1 }]);
    expect(rows[0]!.average).toBe(7.6); // 7.55 rounds up
  });

  it('gives players showing the same average the same rank, and the next player the next rank', () => {
    const rows = playerRatings(PLAYERS, [
      { playerId: 'p1', rating: 7.4 }, { playerId: 'p2', rating: 7.4 }, { playerId: 'p4', rating: 6 },
    ]);
    const ranks = Object.fromEntries(rows.map((r) => [r.playerId, r.rank]));
    expect(ranks).toMatchObject({ p1: 1, p2: 1, p4: 2 });
  });

  it('orders equal averages by name', () => {
    const rows = playerRatings(PLAYERS, [{ playerId: 'p2', rating: 7 }, { playerId: 'p1', rating: 7 }]);
    expect(rows.slice(0, 2).map((r) => r.name)).toEqual(['Ana', 'Ben']);
  });

  it('sorts unrated players last, with no average and no rank', () => {
    const rows = playerRatings(PLAYERS, [{ playerId: 'p4', rating: 2 }]);
    expect(rows[0]!.playerId).toBe('p4');
    const unrated = rows.slice(1);
    expect(unrated).toHaveLength(3);
    expect(unrated.every((r) => r.average === null && r.rank === null && r.gamesRated === 0)).toBe(true);
  });

  it('returns nothing for a tournament with no players', () => {
    expect(playerRatings([], [])).toEqual([]);
  });

  it('ignores a rating for a player it was not given', () => {
    const rows = playerRatings(PLAYERS, [{ playerId: 'ghost', rating: 9 }]);
    expect(rows.every((r) => r.average === null)).toBe(true);
  });
});

describe('teamRatings', () => {
  it('averages the players averages, not the raw ratings', () => {
    // Ana plays twice at 9 and 9, Ben once at 3. Player averages are 9 and 3, so the team is 6 -
    // an average over the three ratings would have been 7.
    const rows = teamRatings(playerRatings(PLAYERS, [
      { playerId: 'p1', rating: 9 }, { playerId: 'p1', rating: 9 }, { playerId: 'p2', rating: 3 },
    ]));
    expect(rows.find((r) => r.teamId === 't1')).toMatchObject({ average: 6, playersRated: 2, rank: 1 });
  });

  it('leaves an unrated player out of the mean rather than counting them as zero', () => {
    const rows = teamRatings(playerRatings(PLAYERS, [{ playerId: 'p1', rating: 8 }]));
    expect(rows.find((r) => r.teamId === 't1')).toMatchObject({ average: 8, playersRated: 1 });
  });

  it('sorts a team with nobody rated last, with no average and no rank', () => {
    const rows = teamRatings(playerRatings(PLAYERS, [{ playerId: 'p1', rating: 8 }]));
    expect(rows.map((r) => r.teamId)).toEqual(['t1', 't2']);
    expect(rows[1]).toMatchObject({ average: null, rank: null, playersRated: 0 });
  });

  it('gives level teams the same rank', () => {
    const rows = teamRatings(playerRatings(PLAYERS, [{ playerId: 'p1', rating: 5 }, { playerId: 'p4', rating: 5 }]));
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });
});

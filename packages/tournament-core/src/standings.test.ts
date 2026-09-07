import { describe, it, expect } from 'vitest';
import { poolStandings, unresolvedTies, type StandingRow } from './standings';
import { makeMatch } from './testUtils';
import type { Game, Match, TeamRef } from './types';

const teams: TeamRef[] = [
  { id: 'A', name: 'Aces' },
  { id: 'B', name: 'Birdies' },
  { id: 'C', name: 'Clears' },
  { id: 'D', name: 'Drops' },
];

interface Played { id: string; a: string; b: string; games: [number, number][] }

/** Builds done matches plus their games; the winner is whoever took more games. */
function build(played: Played[]): { matches: Match[]; games: Record<string, Game[]> } {
  const matches: Match[] = [];
  const games: Record<string, Game[]> = {};
  for (const p of played) {
    const gamesA = p.games.filter(([x, y]) => x > y).length;
    const winnerId = gamesA > p.games.length / 2 ? p.a : p.b;
    matches.push(makeMatch({ id: p.id, stage: 'pool', poolId: 'P', teamAId: p.a, teamBId: p.b, status: 'done', winnerId }));
    games[p.id] = p.games.map(([scoreA, scoreB], i) => ({ gameNo: i + 1, scoreA, scoreB }));
  }
  return { matches, games };
}

describe('poolStandings', () => {
  it('ranks by match wins first', () => {
    const { matches, games } = build([
      { id: 'm1', a: 'A', b: 'B', games: [[15, 3], [15, 3]] },   // A +24, B -24
      { id: 'm2', a: 'C', b: 'A', games: [[15, 13], [15, 13]] }, // C +4,  A +20
      { id: 'm3', a: 'C', b: 'B', games: [[15, 0], [15, 0]] },   // C +34, B -54
    ]);
    const rows = poolStandings(teams, matches, games);
    // C 2 wins, A 1 win, then D (0 wins, 0 diff) ahead of B (0 wins, -54)
    expect(rows.map((r) => r.teamId)).toEqual(['C', 'A', 'D', 'B']);
    expect(rows[0]).toMatchObject({
      played: 2, won: 2, lost: 0, gamesWon: 4, gamesLost: 0, pointsFor: 60, pointsAgainst: 26, pointDiff: 34,
    });
  });

  it('breaks equal wins by point difference', () => {
    const { matches, games } = build([
      { id: 'm1', a: 'A', b: 'C', games: [[15, 5], [15, 5]] },   // A +20, C -20
      { id: 'm2', a: 'B', b: 'D', games: [[15, 13], [15, 13]] }, // B +4,  D -4
    ]);
    expect(poolStandings(teams, matches, games).map((r) => r.teamId)).toEqual(['A', 'B', 'D', 'C']);
  });

  it('uses head-to-head when exactly two teams tie on wins and point difference', () => {
    // Every result is 15-13, 15-13 (a +4 swing).
    const { matches, games } = build([
      { id: 'm1', a: 'B', b: 'A', games: [[15, 13], [15, 13]] }, // B beats A: B +4, A -4
      { id: 'm2', a: 'A', b: 'C', games: [[15, 13], [15, 13]] }, // A beats C: A 0,  C -4
      { id: 'm3', a: 'C', b: 'B', games: [[15, 13], [15, 13]] }, // C beats B: C 0,  B 0
      { id: 'm4', a: 'B', b: 'D', games: [[15, 13], [15, 13]] }, // B beats D: B +4, D -4
      { id: 'm5', a: 'A', b: 'D', games: [[15, 13], [15, 13]] }, // A beats D: A +4, D -8
    ]);
    const rows = poolStandings(teams, matches, games);
    expect(rows.find((r) => r.teamId === 'A')).toMatchObject({ won: 2, pointDiff: 4 });
    expect(rows.find((r) => r.teamId === 'B')).toMatchObject({ won: 2, pointDiff: 4 });
    expect(rows.find((r) => r.teamId === 'C')).toMatchObject({ won: 1, pointDiff: 0 });
    // Only A and B are tied; B beat A, so B ranks above A even though "Aces" sorts first by name.
    expect(rows.map((r) => r.teamId)).toEqual(['B', 'A', 'C', 'D']);
  });

  it('falls back to name order for a three-way tie', () => {
    const { matches, games } = build([
      { id: 'm1', a: 'A', b: 'B', games: [[15, 13], [15, 13]] }, // A +4, B -4
      { id: 'm2', a: 'B', b: 'C', games: [[15, 13], [15, 13]] }, // B 0,  C -4
      { id: 'm3', a: 'C', b: 'A', games: [[15, 13], [15, 13]] }, // C 0,  A 0
    ]);
    // A, B, C all 1 win and 0 diff: head-to-head is skipped (group of three), names decide.
    const rows = poolStandings(teams, matches, games);
    expect(rows.map((r) => r.teamId)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows.slice(0, 3).every((r) => r.tieUnresolved)).toBe(true);
    expect(rows[3]).toMatchObject({ teamId: 'D', tieUnresolved: false });
  });

  it('ignores matches that are not done', () => {
    const matches = [makeMatch({ id: 'm1', teamAId: 'A', teamBId: 'B', status: 'live' })];
    const rows = poolStandings(teams, matches, { m1: [{ gameNo: 1, scoreA: 15, scoreB: 3 }] });
    expect(rows.every((r) => r.played === 0)).toBe(true);
    expect(rows.map((r) => r.teamId)).toEqual(['A', 'B', 'C', 'D']); // alphabetical by name
  });
});

describe('club format ordering', () => {
  const four: TeamRef[] = [{ id: 'A', name: 'Aces' }, { id: 'B', name: 'Birdies' }, { id: 'C', name: 'Clears' }, { id: 'D', name: 'Drops' }];
  const g1 = (a: number, b: number) => [{ gameNo: 1, scoreA: a, scoreB: b }];
  const done = (id: string, a: string, b: string, sa: number, sb: number, stage: 'pool' | 'playoff' = 'pool'): [Match, Game[]] => [
    makeMatch({ id, stage, poolId: 'P', teamAId: a, teamBId: b, status: 'done', winnerId: sa > sb ? a : b }), g1(sa, sb),
  ];
  const build = (list: [Match, Game[]][]) => ({ matches: list.map(([m]) => m), games: Object.fromEntries(list.map(([m, g]) => [m.id, g])) });

  it('gives one point per win and exposes it', () => {
    const { matches, games } = build([done('m1', 'A', 'B', 15, 9), done('m2', 'C', 'D', 15, 3), done('m3', 'A', 'C', 15, 14)]);
    const rows = poolStandings(four, matches, games);
    expect(rows.map((r) => [r.teamId, r.points])).toEqual([['A', 2], ['C', 1], ['B', 0], ['D', 0]]);
  });

  it('a recorded playoff between two tied teams decides before head-to-head', () => {
    // B beat C in the pool, but C won the playoff -> C ranks above B
    const { matches, games } = build([
      done('m1', 'A', 'B', 15, 9), done('m2', 'A', 'C', 15, 9), done('m3', 'B', 'C', 15, 9),
      done('m4', 'A', 'D', 15, 9), done('m5', 'B', 'D', 9, 15), done('m6', 'C', 'D', 15, 9),
      done('po', 'B', 'C', 10, 15, 'playoff'),
    ]);
    const rows = poolStandings(four, matches, games);
    expect(rows.map((r) => r.teamId)).toEqual(['A', 'C', 'B', 'D']);
    expect(rows.find((r) => r.teamId === 'B')!.played).toBe(3); // playoff not counted
    expect(rows.every((r) => !r.tieUnresolved)).toBe(true);
  });

  it('head-to-head then score difference resolve two-way ties', () => {
    const { matches, games } = build([done('m1', 'A', 'B', 15, 9), done('m2', 'B', 'C', 15, 9), done('m3', 'C', 'A', 15, 9), done('m4', 'A', 'D', 15, 9), done('m5', 'B', 'D', 15, 9), done('m6', 'C', 'D', 15, 9)]);
    // A, B, C all 2 points with a circular head-to-head and equal diff -> unresolved three-way
    const rows = poolStandings(four, matches, games);
    expect(rows.slice(0, 3).every((r) => r.tieUnresolved)).toBe(true);
    expect(rows[3]).toMatchObject({ teamId: 'D', tieUnresolved: false });
  });

  it('manual order overrides everything and clears flags', () => {
    const { matches, games } = build([done('m1', 'A', 'B', 15, 9)]);
    const rows = poolStandings(four, matches, games, { manualOrder: ['D', 'B'] });
    expect(rows.map((r) => r.teamId)).toEqual(['D', 'B', 'A', 'C']);
    expect(rows.every((r) => !r.tieUnresolved)).toBe(true);
  });
});

describe('unresolvedTies', () => {
  const row = (teamId: string, points: number, tieUnresolved: boolean): StandingRow => ({ teamId, name: teamId, played: 3, won: points, lost: 3 - points, points, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0, tieUnresolved });
  it('flags a tie spanning the qualification line', () => {
    const rows = [row('A', 3, false), row('B', 2, true), row('C', 2, true), row('D', 0, false)];
    expect(unresolvedTies(rows, 2)).toEqual([{ teamIds: ['B', 'C'], affects: 'qualification' }]);
  });
  it('flags a tie for first as seeding', () => {
    const rows = [row('A', 3, true), row('B', 3, true), row('C', 1, false), row('D', 0, false)];
    expect(unresolvedTies(rows, 2)).toEqual([{ teamIds: ['A', 'B'], affects: 'seeding' }]);
  });
  it('ignores ties below the line', () => {
    const rows = [row('A', 3, false), row('B', 2, false), row('C', 1, true), row('D', 1, true)];
    expect(unresolvedTies(rows, 2)).toEqual([]);
  });
});

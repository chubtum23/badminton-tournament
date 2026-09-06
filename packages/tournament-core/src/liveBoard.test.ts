import { describe, it, expect } from 'vitest';
import { liveBoard } from './liveBoard';
import { makeMatch } from './testUtils';

describe('liveBoard', () => {
  const matches = [
    makeMatch({ id: 'a1', poolId: 'A', slot: 1, status: 'done', teamAId: 't1', teamBId: 't2', winnerId: 't1' }),
    makeMatch({ id: 'a2', poolId: 'A', slot: 2, status: 'live', court: 2, teamAId: 't3', teamBId: 't4' }),
    makeMatch({ id: 'a3', poolId: 'A', slot: 3, status: 'ready', teamAId: 't1', teamBId: 't3' }),
    makeMatch({ id: 'a4', poolId: 'A', slot: 4, status: 'ready', teamAId: 't2', teamBId: 't4' }),
    makeMatch({ id: 'b1', poolId: 'B', slot: 1, status: 'live', court: 1, teamAId: 't5', teamBId: 't6' }),
    makeMatch({ id: 'b2', poolId: 'B', slot: 2, status: 'ready', teamAId: 't7', teamBId: 't8' }),
    makeMatch({ id: 'c1', poolId: 'C', slot: 1, status: 'submitted', teamAId: 't9', teamBId: 't10' }),
  ];

  it('lists live matches ordered by court', () => {
    expect(liveBoard(matches, 'pool', ['A', 'B', 'C']).nowPlaying.map((m) => m.id)).toEqual(['b1', 'a2']);
  });

  it('picks the lowest ready slot per pool in pool order', () => {
    expect(liveBoard(matches, 'pool', ['A', 'B', 'C']).upNext.map((m) => m.id)).toEqual(['a3', 'b2']);
    expect(liveBoard(matches, 'pool', ['B', 'A', 'C']).upNext.map((m) => m.id)).toEqual(['b2', 'a3']);
  });

  it('sorts a match from an unknown pool after all known pools', () => {
    const unknown = makeMatch({ id: 'z1', poolId: 'Z', slot: 1, status: 'ready', teamAId: 't11', teamBId: 't12' });
    expect(liveBoard([...matches, unknown], 'pool', ['A', 'B']).upNext.map((m) => m.id)).toEqual(['a3', 'b2', 'z1']);
  });

  it('skips ready matches already sent to a court', () => {
    const withCourt = matches.map((m) => (m.id === 'a3' ? { ...m, court: 3 } : m));
    expect(liveBoard(withCourt, 'pool', ['A', 'B']).upNext.map((m) => m.id)).toEqual(['a4', 'b2']);
  });

  it('in the knockout picks the lowest ready slot per round, earliest round first', () => {
    const ko = [
      makeMatch({ id: 'r1s1', stage: 'knockout', round: 1, slot: 1, status: 'done', winnerId: 'x' }),
      makeMatch({ id: 'r1s2', stage: 'knockout', round: 1, slot: 2, status: 'ready', teamAId: 'x', teamBId: 'y' }),
      makeMatch({ id: 'r1s3', stage: 'knockout', round: 1, slot: 3, status: 'ready', teamAId: 'x', teamBId: 'y' }),
      makeMatch({ id: 'r2s1', stage: 'knockout', round: 2, slot: 1, status: 'ready', teamAId: 'x', teamBId: 'y' }),
      makeMatch({ id: 'r2s2', stage: 'knockout', round: 2, slot: 2, status: 'pending' }),
    ];
    expect(liveBoard(ko, 'knockout').upNext.map((m) => m.id)).toEqual(['r1s2', 'r2s1']);
  });

  it('only considers matches from the requested stage', () => {
    const mixed = [...matches, makeMatch({ id: 'k1', stage: 'knockout', round: 1, slot: 1, status: 'ready', teamAId: 'x', teamBId: 'y' })];
    expect(liveBoard(mixed, 'knockout').upNext.map((m) => m.id)).toEqual(['k1']);
    expect(liveBoard(mixed, 'knockout').nowPlaying).toHaveLength(2);
  });
});

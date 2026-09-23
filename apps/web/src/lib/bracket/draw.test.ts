import { describe, expect, it } from 'vitest';
import { buildBracketFromSeats, type PoolResult } from '@tournament/core';
import { firstRoundPairs, randomSeats, seatsMatch, seededSeats, swapSeats } from './draw';

const pools: PoolResult[] = [
  { poolId: 'P1', ranked: ['a1', 'a2'] },
  { poolId: 'P2', ranked: ['b1', 'b2'] },
];

describe('seededSeats', () => {
  it('pads to the bracket size and keeps the seeding', () => {
    const seats = seededSeats(pools, 2);
    expect(seats).toHaveLength(4);
    expect(new Set(seats)).toEqual(new Set(['a1', 'a2', 'b1', 'b2']));
  });

  it('leaves byes where there are not enough qualifiers', () => {
    const seats = seededSeats([{ poolId: 'P1', ranked: ['a1', 'a2'] }, { poolId: 'P2', ranked: ['b1'] }], 1);
    expect(seats).toEqual(['a1', 'b1']);
    const six = seededSeats([...pools, { poolId: 'P3', ranked: ['c1', 'c2'] }], 2);
    expect(six).toHaveLength(8);
    expect(six.filter((s) => s === null)).toHaveLength(2);
  });
});

describe('randomSeats', () => {
  it('keeps every qualifier exactly once', () => {
    const ids = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
    for (let i = 0; i < 50; i++) {
      const seats = randomSeats(ids);
      expect(seats).toHaveLength(8);
      expect([...seats].filter((s) => s !== null).sort()).toEqual([...ids].sort());
    }
  });

  it('is a real shuffle, not the seeded order', () => {
    const ids = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2'];
    const seen = new Set(Array.from({ length: 30 }, () => randomSeats(ids).join(',')));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('seatsMatch', () => {
  const ids = ['a1', 'a2', 'b1', 'b2'];
  it('accepts a draw holding exactly the qualifiers', () => {
    expect(seatsMatch(['b2', 'a1', 'b1', 'a2'], ids)).toBe(true);
  });
  it('rejects a stale or broken draw', () => {
    expect(seatsMatch(null, ids)).toBe(false);
    expect(seatsMatch(['b2', 'a1', 'b1', 'zz'], ids)).toBe(false); // a team that no longer qualifies
    expect(seatsMatch(['b2', 'a1', 'b1'], ids)).toBe(false); // wrong size
    expect(seatsMatch(['a1', 'a1', 'b1', 'b2'], ids)).toBe(false); // twice in the draw
  });
});

describe('swapSeats', () => {
  it('swaps two teams rather than duplicating one', () => {
    expect(swapSeats(['a1', 'a2', 'b1', 'b2'], 0, 'b1')).toEqual(['b1', 'a2', 'a1', 'b2']);
  });
  it('moves a team into a bye place, and the bye to where it came from', () => {
    expect(swapSeats(['a1', 'a2', 'b1', null], 3, 'a1')).toEqual([null, 'a2', 'b1', 'a1']);
  });
  it('hands a place its bye by sending the team to the bye place', () => {
    expect(swapSeats(['a1', 'a2', 'b1', null], 0, null)).toEqual([null, 'a2', 'b1', 'a1']);
  });
  it('leaves a full draw alone when there is no bye to give', () => {
    expect(swapSeats(['a1', 'a2', 'b1', 'b2'], 0, null)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });
});

describe('the draw drives the bracket', () => {
  it('pairs the first round exactly as the draw reads', () => {
    const seats = ['a1', 'b2', 'b1', 'a2'];
    const pairs = firstRoundPairs(seats);
    expect(pairs).toEqual([[0, 3], [1, 2]]); // seeds 1v4 and 2v3
    const matches = buildBracketFromSeats(seats, (() => { let n = 0; return () => `m${++n}`; })());
    const first = matches.filter((m) => m.round === 1).sort((x, y) => x.slot - y.slot);
    expect(first.map((m) => [m.teamAId, m.teamBId])).toEqual([['a1', 'a2'], ['b2', 'b1']]);
  });

  it('walks a lone team through its bye', () => {
    // Seeds 1v4 and 2v3: the empty seed 2 leaves b1, in seed 3, with nobody to play.
    const matches = buildBracketFromSeats(['a1', null, 'b1', 'a2'], (() => { let n = 0; return () => `m${++n}`; })());
    const bye = matches.find((m) => m.round === 1 && m.decidedBy === 'bye');
    expect(bye).toMatchObject({ winnerId: 'b1', status: 'done' });
    // and they are already standing in the final.
    const final = matches.find((m) => m.round === 2);
    expect([final!.teamAId, final!.teamBId]).toContain('b1');
  });
});

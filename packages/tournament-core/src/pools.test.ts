import { describe, it, expect } from 'vitest';
import { shuffle, assignPools, roundRobin, poolMatches } from './pools';
import { seededRng, idGen } from './testUtils';

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

describe('shuffle', () => {
  it('returns a permutation and does not mutate the input', () => {
    const input = teams(8);
    const copy = [...input];
    const out = shuffle(input, seededRng(1));
    expect(input).toEqual(copy);
    expect([...out].sort()).toEqual([...input].sort());
  });

  it('is deterministic for a given rng seed', () => {
    expect(shuffle(teams(8), seededRng(42))).toEqual(shuffle(teams(8), seededRng(42)));
  });

  it('actually reorders for most seeds', () => {
    const differs = [1, 2, 3, 4, 5].some((seed) => shuffle(teams(8), seededRng(seed)).join() !== teams(8).join());
    expect(differs).toBe(true);
  });
});

describe('assignPools', () => {
  it('deals 16 teams into 4 pools of 4', () => {
    const pools = assignPools(teams(16), 4, seededRng(7));
    expect(pools).toHaveLength(4);
    expect(pools.map((p) => p.length)).toEqual([4, 4, 4, 4]);
    expect(pools.flat().sort()).toEqual(teams(16).sort());
  });

  it('spreads a remainder across the first pools', () => {
    const pools = assignPools(teams(10), 3, seededRng(7));
    expect(pools.map((p) => p.length)).toEqual([4, 3, 3]);
  });

  it('ignores input order (placement is random, not seeded)', () => {
    const a = assignPools(teams(8), 2, seededRng(3));
    const b = assignPools([...teams(8)].reverse(), 2, seededRng(3));
    // same rng, different input order => different pools; proves order is not preserved
    expect(a).not.toEqual(b);
  });

  it('rejects impossible pool counts', () => {
    expect(() => assignPools(teams(4), 0, seededRng(1))).toThrow('poolCount must be a positive integer');
    expect(() => assignPools(teams(4), 5, seededRng(1))).toThrow('more pools than teams');
  });
});

describe('roundRobin', () => {
  const pairKey = (a: string, b: string) => [a, b].sort().join('-');

  it('schedules every pair exactly once', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const pairings = roundRobin(teams(n));
      expect(pairings).toHaveLength((n * (n - 1)) / 2);
      const keys = pairings.map((p) => pairKey(p.teamAId, p.teamBId));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('numbers slots from 1 in order', () => {
    expect(roundRobin(teams(4)).map((p) => p.slot)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('never has a team in both matches of the same round (4 teams)', () => {
    const p = roundRobin(teams(4));
    for (const [x, y] of [[0, 1], [2, 3], [4, 5]] as const) {
      const a = p[x]!, b = p[y]!;
      expect(new Set([a.teamAId, a.teamBId, b.teamAId, b.teamBId]).size).toBe(4);
    }
  });

  it('alternates which side the fixed team plays on', () => {
    const p = roundRobin(teams(4));
    const sides = p.filter((m) => m.teamAId === 't1' || m.teamBId === 't1').map((m) => (m.teamAId === 't1' ? 'a' : 'b'));
    expect(new Set(sides).size).toBe(2);
  });

  it('returns nothing for fewer than two teams', () => {
    expect(roundRobin([])).toEqual([]);
    expect(roundRobin(['t1'])).toEqual([]);
  });
});

describe('poolMatches', () => {
  it('turns pairings into ready pool matches', () => {
    const ms = poolMatches('poolA', teams(3), idGen());
    expect(ms).toHaveLength(3);
    expect(ms[0]).toEqual({
      id: 'm1', stage: 'pool', poolId: 'poolA', round: null, slot: 1,
      teamAId: expect.any(String), teamBId: expect.any(String), court: null,
      status: 'ready', winnerId: null, nextMatchId: null, nextMatchSide: null,
    });
  });
});

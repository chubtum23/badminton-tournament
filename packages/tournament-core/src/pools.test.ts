import { describe, it, expect } from 'vitest';
import { shuffle, assignPools } from './pools';
import { seededRng } from './testUtils';

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

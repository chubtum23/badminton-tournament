import { describe, it, expect } from 'vitest';
import { planPools, planLock } from './plan';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
let seed = 1;
const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

describe('planPools', () => {
  it('names pools A, B, C and deals every team once', () => {
    const { pools } = planPools(ids(10), 3, rng);
    expect(pools.map((p) => p.name)).toEqual(['Pool A', 'Pool B', 'Pool C']);
    expect(pools.map((p) => p.position)).toEqual([1, 2, 3]);
    expect(pools.flatMap((p) => p.teamIds).sort()).toEqual(ids(10).sort());
    expect(pools.map((p) => p.teamIds.length)).toEqual([4, 3, 3]);
  });
});

describe('planLock', () => {
  it('creates a round robin per pool with ready status and pool ids set', () => {
    let n = 0;
    const ms = planLock([{ id: 'pA', teamIds: ids(4) }, { id: 'pB', teamIds: ['x', 'y', 'z'] }], () => `m${++n}`);
    expect(ms).toHaveLength(6 + 3);
    expect(ms.filter((m) => m.poolId === 'pA')).toHaveLength(6);
    expect(ms.every((m) => m.stage === 'pool' && m.status === 'ready' && m.round === null)).toBe(true);
    expect(new Set(ms.map((m) => m.id)).size).toBe(9);
  });
});

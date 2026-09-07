import { describe, it, expect } from 'vitest';
import { planKnockout, type PoolResultInput } from './plan';

// Strength order A1 > A2 > A3 and B1 > B2 > B3, already computed by computePool.
const pools: PoolResultInput[] = [
  { poolId: 'pA', name: 'Pool A', ranked: ['A1', 'A2', 'A3'], unresolved: false },
  { poolId: 'pB', name: 'Pool B', ranked: ['B1', 'B2', 'B3'], unresolved: false },
];
let n = 0;
const newId = () => `k${++n}`;

describe('planKnockout', () => {
  it('refuses while any pool match is unfinished', () => {
    const r = planKnockout({ pools, advancePerPool: 2, newId, unfinishedPoolMatches: 1 });
    expect(r).toMatchObject({ error: expect.stringMatching(/1 pool match/) });
  });

  it('builds the bracket from the top N of each pool', () => {
    const r = planKnockout({ pools, advancePerPool: 2, newId });
    if ('error' in r) throw new Error(r.error);
    expect(r.qualifiers).toEqual([{ poolId: 'pA', ranked: ['A1', 'A2'] }, { poolId: 'pB', ranked: ['B1', 'B2'] }]);
    expect(r.matches).toHaveLength(3);
    const r1 = r.matches.filter((m) => m.round === 1).sort((x, y) => x.slot - y.slot);
    expect([r1[0]!.teamAId, r1[0]!.teamBId]).toEqual(['A1', 'B2']);
    expect([r1[1]!.teamAId, r1[1]!.teamBId]).toEqual(['B1', 'A2']);
    expect(r.matches.every((m) => m.stage === 'knockout' && m.poolId === null)).toBe(true);
  });

  it('refuses when a pool is smaller than advancePerPool', () => {
    const r = planKnockout({ pools, advancePerPool: 4, newId });
    expect(r).toMatchObject({ error: expect.stringMatching(/Pool A/) });
  });

  // knockoutInput sets `unresolved` from every tie computePool reports, whether it decides who
  // qualifies or only who is seeded first, and reports none at all once the order is manual.
  it('refuses while a pool has any unresolved tie', () => {
    const withTie = pools.map((p) => (p.poolId === 'pA' ? { ...p, unresolved: true } : p));
    const r = planKnockout({ pools: withTie, advancePerPool: 2, newId });
    expect(r).toMatchObject({
      error: 'Pool A has an unresolved tie; record a playoff or set the order manually',
    });
  });

  it('uses the order it is given, so a manual order changes who qualifies', () => {
    const manual = pools.map((p) => (p.poolId === 'pA' ? { ...p, ranked: ['A3', 'A2', 'A1'] } : p));
    const r = planKnockout({ pools: manual, advancePerPool: 2, newId });
    if ('error' in r) throw new Error(r.error);
    expect(r.qualifiers[0]).toEqual({ poolId: 'pA', ranked: ['A3', 'A2'] });
  });
});

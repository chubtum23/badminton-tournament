import { describe, it, expect } from 'vitest';
import type { Match } from '@tournament/core';
import { planKnockout } from './plan';

const pools = [{ id: 'pA', name: 'Pool A' }, { id: 'pB', name: 'Pool B' }];
const teams = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].map((id) => ({ id, name: id }));
const teamPoolIds = Object.fromEntries(teams.map((t) => [t.id, t.id.startsWith('A') ? 'pA' : 'pB']));

function poolMatch(id: string, poolId: string, a: string, b: string, winner: string | null): Match {
  return { id, stage: 'pool', poolId, round: null, slot: 1, teamAId: a, teamBId: b, court: null,
    status: winner ? 'done' : 'ready', winnerId: winner, decidedBy: 'played', nextMatchId: null, nextMatchSide: null };
}
// Strength order A1 > A2 > A3 and B1 > B2 > B3
const done: Match[] = [
  poolMatch('a12', 'pA', 'A1', 'A2', 'A1'), poolMatch('a13', 'pA', 'A1', 'A3', 'A1'), poolMatch('a23', 'pA', 'A2', 'A3', 'A2'),
  poolMatch('b12', 'pB', 'B1', 'B2', 'B1'), poolMatch('b13', 'pB', 'B1', 'B3', 'B1'), poolMatch('b23', 'pB', 'B2', 'B3', 'B2'),
];
const games = Object.fromEntries(done.map((m) => [m.id, [{ gameNo: 1, scoreA: 15, scoreB: 10 }, { gameNo: 2, scoreA: 15, scoreB: 10 }]]));
let n = 0;
const newId = () => `k${++n}`;

describe('planKnockout', () => {
  it('refuses while any pool match is unfinished', () => {
    const r = planKnockout({ pools, teams, teamPoolIds, matches: [...done.slice(0, 5), poolMatch('b23', 'pB', 'B2', 'B3', null)], games, advancePerPool: 2, newId });
    expect(r).toMatchObject({ error: expect.stringMatching(/1 pool match/) });
  });

  it('ranks each pool and builds the bracket from the top N', () => {
    const r = planKnockout({ pools, teams, teamPoolIds, matches: done, games, advancePerPool: 2, newId });
    if ('error' in r) throw new Error(r.error);
    expect(r.qualifiers).toEqual([{ poolId: 'pA', ranked: ['A1', 'A2'] }, { poolId: 'pB', ranked: ['B1', 'B2'] }]);
    expect(r.matches).toHaveLength(3);
    const r1 = r.matches.filter((m) => m.round === 1).sort((x, y) => x.slot - y.slot);
    expect([r1[0]!.teamAId, r1[0]!.teamBId]).toEqual(['A1', 'B2']);
    expect([r1[1]!.teamAId, r1[1]!.teamBId]).toEqual(['B1', 'A2']);
    expect(r.matches.every((m) => m.stage === 'knockout' && m.poolId === null)).toBe(true);
  });

  it('refuses when a pool is smaller than advancePerPool', () => {
    const r = planKnockout({ pools, teams, teamPoolIds, matches: done, games, advancePerPool: 4, newId });
    expect(r).toMatchObject({ error: expect.stringMatching(/Pool A/) });
  });
});

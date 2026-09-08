import { describe, it, expect } from 'vitest';
import type { Match, StandingRow } from '@tournament/core';
import type { PoolRow, TeamRow } from '@/lib/db/types';
import { centreMatch, drawModel, halfRounds, roundTitle } from './model';

const pool = (id: string, position: number): PoolRow => ({ id, tournament_id: 't', name: `Pool ${id.toUpperCase()}`, position, locked: true });

const team = (id: string, poolId: string | null): TeamRow => ({
  id, tournament_id: 't', name: id.toUpperCase(), tagline: '', colour: '#2563eb', description: '',
  seed: null, pool_id: poolId, pool_order: 0, withdrawn: false, pool_rank_override: null,
});

const match = (o: Partial<Match> & { id: string }): Match => ({
  stage: 'knockout', poolId: null, round: 1, slot: 1, teamAId: null, teamBId: null,
  status: 'ready', winnerId: null, decidedBy: 'played', nextMatchId: null, nextMatchSide: null, ...o,
});

const standing = (teamId: string, points: number): StandingRow => ({
  teamId, name: teamId.toUpperCase(), played: 3, won: points, lost: 3 - points, points,
  gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0, pointDiff: 0, tieUnresolved: false,
});

/** Four pools of two qualifiers: two quarter-finals a side, one semi a side, one final. */
function fourPoolDraw() {
  const pools = [pool('a', 0), pool('b', 1), pool('c', 2), pool('d', 3)];
  const teams = [
    team('a1', 'a'), team('a2', 'a'), team('b1', 'b'), team('b2', 'b'),
    team('c1', 'c'), team('c2', 'c'), team('d1', 'd'), team('d2', 'd'),
  ];
  const matches = [
    match({ id: 'qf1', round: 1, slot: 1, teamAId: 'a1', teamBId: 'b2', nextMatchId: 'sf1', nextMatchSide: 'a' }),
    match({ id: 'qf2', round: 1, slot: 2, teamAId: 'b1', teamBId: 'a2', nextMatchId: 'sf1', nextMatchSide: 'b' }),
    match({ id: 'qf3', round: 1, slot: 3, teamAId: 'c1', teamBId: 'd2', nextMatchId: 'sf2', nextMatchSide: 'a' }),
    match({ id: 'qf4', round: 1, slot: 4, teamAId: 'd1', teamBId: 'c2', nextMatchId: 'sf2', nextMatchSide: 'b' }),
    match({ id: 'sf1', round: 2, slot: 1, nextMatchId: 'final', nextMatchSide: 'a' }),
    match({ id: 'sf2', round: 2, slot: 2, nextMatchId: 'final', nextMatchSide: 'b' }),
    match({ id: 'final', round: 3, slot: 1 }),
  ];
  const standings = Object.fromEntries(pools.map((p) => {
    const k = p.id;
    return [p.id, [standing(`${k}1`, 3), standing(`${k}2`, 2)]];
  }));
  return { pools, teams, matches, standings, advancePerPool: 2 };
}

describe('drawModel', () => {
  it('sends the first half of the pools left and the rest right, with the final in the middle', () => {
    const m = drawModel(fourPoolDraw());
    expect(m.mirrored).toBe(true);
    expect(m.sides).toEqual({
      qf1: 'left', qf2: 'left', qf3: 'right', qf4: 'right',
      sf1: 'left', sf2: 'right', final: 'centre',
    });
    expect(centreMatch(m)?.id).toBe('final');
  });

  it('orders each half outward from the final', () => {
    const m = drawModel(fourPoolDraw());
    // Left reads pools -> quarters -> semi; right is its mirror, semi nearest the middle.
    expect(halfRounds(m, 'left').map((r) => r.map((x) => x.id))).toEqual([['qf1', 'qf2'], ['sf1']]);
    expect(halfRounds(m, 'right').map((r) => r.map((x) => x.id))).toEqual([['sf2'], ['qf3', 'qf4']]);
  });

  it('marks each pool row that qualifies, in finishing order', () => {
    const m = drawModel(fourPoolDraw());
    expect(m.pools.map((p) => p.name)).toEqual(['Pool A', 'Pool B', 'Pool C', 'Pool D']);
    expect(m.pools[0]!.rows.map((r) => [r.name, r.points, r.qualifies]))
      .toEqual([['A1', 3, true], ['A2', 2, true]]);
  });

  it('keeps only the top advancePerPool rows highlighted', () => {
    const base = fourPoolDraw();
    base.standings['a'] = [standing('a1', 3), standing('a2', 2), standing('a3', 1)];
    base.teams.push(team('a3', 'a'));
    const m = drawModel(base);
    expect(m.pools[0]!.rows.map((r) => r.qualifies)).toEqual([true, true, false]);
  });

  it('is mirrored with pools drawn but no knockout yet, so the tree shows from the start', () => {
    const base = fourPoolDraw();
    const m = drawModel({ ...base, matches: [] });
    expect(m.mirrored).toBe(true);
    expect(m.rounds).toEqual([]);
    expect(centreMatch(m)).toBeNull();
  });

  it('falls back to left-to-right for an odd number of pools', () => {
    const base = fourPoolDraw();
    const m = drawModel({ ...base, pools: base.pools.slice(0, 3), matches: [] });
    expect(m.mirrored).toBe(false);
  });

  it('falls back when a round cannot be split evenly between the halves', () => {
    const pools = [pool('a', 0), pool('b', 1)];
    const teams = [team('a1', 'a'), team('a2', 'a'), team('b1', 'b'), team('b2', 'b')];
    // Both first-round matches draw their side A team out of pool A, so the left is overloaded.
    const matches = [
      match({ id: 'sf1', round: 1, slot: 1, teamAId: 'a1', teamBId: 'a2', nextMatchId: 'final', nextMatchSide: 'a' }),
      match({ id: 'sf2', round: 1, slot: 2, teamAId: 'b1', teamBId: 'b2', nextMatchId: 'final', nextMatchSide: 'b' }),
      match({ id: 'final', round: 2, slot: 1 }),
    ];
    const even = drawModel({ pools, teams, matches, standings: {}, advancePerPool: 2 });
    expect(even.mirrored).toBe(true);

    const lopsided = drawModel({
      pools, teams,
      matches: matches.map((m) => (m.id === 'sf2' ? { ...m, teamAId: 'a2', teamBId: 'b2' } : m)),
      standings: {}, advancePerPool: 2,
    });
    expect(lopsided.mirrored).toBe(false);
  });

  it('ignores pool and playoff matches', () => {
    const base = fourPoolDraw();
    const m = drawModel({
      ...base,
      matches: [...base.matches, match({ id: 'p1', stage: 'pool', round: null }), match({ id: 'po1', stage: 'playoff', round: null })],
    });
    expect(m.rounds.flat().map((x) => x.id)).toEqual(['qf1', 'qf2', 'qf3', 'qf4', 'sf1', 'sf2', 'final']);
  });
});

describe('roundTitle', () => {
  it('names the last three rounds and numbers anything earlier', () => {
    expect([1, 2, 3].map((r) => roundTitle(r, 3))).toEqual(['Quarter-finals', 'Semi-finals', 'Final']);
    expect(roundTitle(1, 4)).toBe('Round 1');
  });
});

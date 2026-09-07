import { describe, it, expect } from 'vitest';
import type { Game, Match } from '@tournament/core';
import type { PoolRow, TeamRow } from '@/lib/db/types';
import { computePool } from './compute';

const pool: PoolRow = { id: 'pA', tournament_id: 't1', name: 'Pool A', position: 0, locked: true };
const otherPool: PoolRow = { ...pool, id: 'pB', name: 'Pool B', position: 1 };

const team = (id: string, name: string, over: Partial<TeamRow> = {}): TeamRow => ({
  id, tournament_id: 't1', name, tagline: '', colour: '#000', seed: null,
  pool_id: 'pA', pool_order: 0, withdrawn: false, pool_rank_override: null, ...over,
});

const teams: TeamRow[] = [
  team('A1', 'Alpha'), team('A2', 'Birdies'), team('A3', 'Clears'),
  team('B1', 'Bravo', { pool_id: 'pB' }),
];

const match = (id: string, over: Partial<Match>): Match => ({
  id, stage: 'pool', poolId: 'pA', round: null, slot: 1, teamAId: null, teamBId: null, court: null,
  status: 'done', winnerId: null, decidedBy: 'played', nextMatchId: null, nextMatchSide: null, ...over,
});

const g = (a: number, b: number): Game[] => [{ gameNo: 1, scoreA: a, scoreB: b }];

/**
 * Pool A's three matches. Alpha beats Birdies 15-10 and Clears 15-10; the Birdies v Clears match
 * is still 'ready', so it contributes nothing. That leaves Alpha on 2 points and Birdies and
 * Clears both on 0 with an identical -5 point difference and no head-to-head between them, so
 * 2nd and 3rd are separated only by name order — a genuine unresolved tie, and with
 * advancePerPool 2 it sits exactly on the qualification line.
 */
const tieMatches: Match[] = [
  match('m1', { teamAId: 'A1', teamBId: 'A2', winnerId: 'A1', slot: 1 }),
  match('m2', { teamAId: 'A1', teamBId: 'A3', winnerId: 'A1', slot: 2 }),
  match('m3', { teamAId: 'A2', teamBId: 'A3', status: 'ready', winnerId: null, slot: 3 }),
];
const tieGames: Record<string, Game[]> = { m1: g(15, 10), m2: g(15, 10) };

describe('computePool', () => {
  it('uses the organiser order when any team has a rank override', () => {
    const withOrder = teams.map((t) => (
      t.id === 'A3' ? { ...t, pool_rank_override: 1 } : t.id === 'A1' ? { ...t, pool_rank_override: 2 } : t.id === 'A2' ? { ...t, pool_rank_override: 3 } : t
    ));
    const r = computePool({ pool, teams: withOrder, matches: tieMatches, games: tieGames, advancePerPool: 2 });
    expect(r.manual).toBe(true);
    expect(r.rows.map((x) => x.teamId)).toEqual(['A3', 'A1', 'A2']);
    expect(r.ties).toEqual([]);
    expect(r.rows.every((x) => x.tieUnresolved === false)).toBe(true);
  });

  it('reports a two-way tie on the qualification line when no playoff exists', () => {
    const r = computePool({ pool, teams, matches: tieMatches, games: tieGames, advancePerPool: 2 });
    expect(r.manual).toBe(false);
    expect(r.playoffs).toEqual([]);
    expect(r.ties).toHaveLength(1);
    expect(r.ties[0]!.affects).toBe('qualification');
    expect([...r.ties[0]!.teamIds].sort()).toEqual(['A2', 'A3']);
  });

  it('resolves the tie once a playoff between the tied teams is done', () => {
    const playoff = match('po1', { stage: 'playoff', slot: 100, teamAId: 'A2', teamBId: 'A3', winnerId: 'A3' });
    const r = computePool({ pool, teams, matches: [...tieMatches, playoff], games: tieGames, advancePerPool: 2 });
    expect(r.ties).toEqual([]);
    expect(r.rows.map((x) => x.teamId)).toEqual(['A1', 'A3', 'A2']);
    expect(r.playoffs.map((m) => m.id)).toEqual(['po1']);
  });

  it('ignores matches from other pools and knockout matches between the same teams', () => {
    const knockout = match('k1', { stage: 'knockout', poolId: null, round: 1, teamAId: 'A2', teamBId: 'A3', winnerId: 'A2' });
    const otherPoolMatch = match('o1', { poolId: 'pB', teamAId: 'A2', teamBId: 'B1', winnerId: 'A2' });
    const r = computePool({ pool, teams, matches: [...tieMatches, knockout, otherPoolMatch], games: tieGames, advancePerPool: 2 });
    expect(r.rows.map((x) => x.teamId)).toEqual(['A1', 'A2', 'A3']);
    expect(r.rows.map((x) => x.played)).toEqual([2, 1, 1]);
    expect(r.ties).toHaveLength(1);
  });

  it('keeps withdrawn teams in the table and only includes this pool', () => {
    const withdrawn = teams.map((t) => (t.id === 'A3' ? { ...t, withdrawn: true } : t));
    const r = computePool({ pool: otherPool, teams: withdrawn, matches: tieMatches, games: tieGames, advancePerPool: 2 });
    expect(r.rows.map((x) => x.teamId)).toEqual(['B1']);
    const a = computePool({ pool, teams: withdrawn, matches: tieMatches, games: tieGames, advancePerPool: 2 });
    expect(a.rows.map((x) => x.teamId)).toContain('A3');
  });
});

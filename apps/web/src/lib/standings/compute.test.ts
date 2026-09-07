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
  id, stage: 'pool', poolId: 'pA', round: null, slot: 1, teamAId: null, teamBId: null,
  status: 'done', winnerId: null, decidedBy: 'played', nextMatchId: null, nextMatchSide: null, ...over,
});

const g = (a: number, b: number): Game[] => [{ gameNo: 1, scoreA: a, scoreB: b }];

/**
 * Pool A fully played, with a circular result: Alpha beats Birdies, Birdies beats Clears and
 * Clears beats Alpha, every match 15-10. All three finish on 1 point with a 0 point difference,
 * and a three-way group is too big for the head-to-head rule, so the order is name order only —
 * a genuine unresolved tie that with advancePerPool 2 spans the qualification line.
 */
const playedMatches: Match[] = [
  match('m1', { teamAId: 'A1', teamBId: 'A2', winnerId: 'A1', slot: 1 }),
  match('m2', { teamAId: 'A2', teamBId: 'A3', winnerId: 'A2', slot: 2 }),
  match('m3', { teamAId: 'A3', teamBId: 'A1', winnerId: 'A3', slot: 3 }),
];
const playedGames: Record<string, Game[]> = { m1: g(15, 10), m2: g(15, 10), m3: g(15, 10) };

/** The same pool with the last fixture still to play: Alpha leads, Birdies and Clears are level. */
const unplayedMatches: Match[] = [
  match('u1', { teamAId: 'A1', teamBId: 'A2', winnerId: 'A1', slot: 1 }),
  match('u2', { teamAId: 'A1', teamBId: 'A3', winnerId: 'A1', slot: 2 }),
  match('u3', { teamAId: 'A2', teamBId: 'A3', status: 'ready', winnerId: null, slot: 3 }),
];
const unplayedGames: Record<string, Game[]> = { u1: g(15, 10), u2: g(15, 10) };

describe('computePool', () => {
  it('uses the organiser order when any team has a rank override', () => {
    const withOrder = teams.map((t) => (
      t.id === 'A3' ? { ...t, pool_rank_override: 1 } : t.id === 'A1' ? { ...t, pool_rank_override: 2 } : t.id === 'A2' ? { ...t, pool_rank_override: 3 } : t
    ));
    const r = computePool({ pool, teams: withOrder, matches: playedMatches, games: playedGames, advancePerPool: 2 });
    expect(r.manual).toBe(true);
    expect(r.rows.map((x) => x.teamId)).toEqual(['A3', 'A1', 'A2']);
    expect(r.ties).toEqual([]);
    expect(r.rows.every((x) => x.tieUnresolved === false)).toBe(true);
  });

  it('reports the tie on the qualification line once every fixture is played', () => {
    const r = computePool({ pool, teams, matches: playedMatches, games: playedGames, advancePerPool: 2 });
    expect(r.manual).toBe(false);
    expect(r.complete).toBe(true);
    expect(r.playoffs).toEqual([]);
    expect(r.ties).toHaveLength(1);
    expect(r.ties[0]!.affects).toBe('qualification');
    expect([...r.ties[0]!.teamIds].sort()).toEqual(['A1', 'A2', 'A3']);
    expect(r.rows.every((x) => x.tieUnresolved)).toBe(true);
  });

  it('reports no tie at all while a fixture is unplayed', () => {
    const r = computePool({ pool, teams, matches: unplayedMatches, games: unplayedGames, advancePerPool: 2 });
    expect(r.complete).toBe(false);
    expect(r.ties).toEqual([]);
    // The red "tie" pill in StandingsTable reads this flag, so it has to be quiet too.
    expect(r.rows.every((x) => x.tieUnresolved === false)).toBe(true);
    // The ranking itself is unaffected: Birdies and Clears are still level, just not flagged.
    expect(r.rows.map((x) => x.teamId)).toEqual(['A1', 'A2', 'A3']);
  });

  it('reports nothing before the draw exists', () => {
    const r = computePool({ pool, teams, matches: [], games: {}, advancePerPool: 2 });
    expect(r.complete).toBe(false);
    expect(r.fixtures).toEqual([]);
    expect(r.ties).toEqual([]);
    expect(r.rows.every((x) => x.tieUnresolved === false)).toBe(true);
  });

  it('lets a done playoff override the head-to-head in a finished pool', () => {
    // Four teams, all six fixtures played: Alpha and Clears finish on 2 points, Birdies and
    // Drives on 1. Alpha beat Clears in the pool, so the head-to-head puts Alpha first until a
    // playoff says otherwise.
    const four = [...teams, team('A4', 'Drives')];
    const matches: Match[] = [
      match('f1', { teamAId: 'A1', teamBId: 'A2', winnerId: 'A1', slot: 1 }),
      match('f2', { teamAId: 'A1', teamBId: 'A3', winnerId: 'A1', slot: 2 }),
      match('f3', { teamAId: 'A4', teamBId: 'A1', winnerId: 'A4', slot: 3 }),
      match('f4', { teamAId: 'A2', teamBId: 'A4', winnerId: 'A2', slot: 4 }),
      match('f5', { teamAId: 'A3', teamBId: 'A4', winnerId: 'A3', slot: 5 }),
      match('f6', { teamAId: 'A3', teamBId: 'A2', winnerId: 'A3', slot: 6 }),
    ];
    const games = Object.fromEntries(matches.map((m) => [m.id, g(15, 10)]));
    const before = computePool({ pool, teams: four, matches, games, advancePerPool: 2 });
    expect(before.complete).toBe(true);
    expect(before.ties).toEqual([]);
    expect(before.rows.map((x) => x.teamId)).toEqual(['A1', 'A3', 'A2', 'A4']);

    const playoff = match('po1', { stage: 'playoff', slot: 101, teamAId: 'A1', teamBId: 'A3', winnerId: 'A3' });
    const after = computePool({ pool, teams: four, matches: [...matches, playoff], games, advancePerPool: 2 });
    expect(after.rows.map((x) => x.teamId)).toEqual(['A3', 'A1', 'A2', 'A4']);
    expect(after.playoffs.map((m) => m.id)).toEqual(['po1']);
    expect(after.ties).toEqual([]);
  });

  it('lists this pool\'s fixtures in slot order and leaves other stages out', () => {
    const extras: Match[] = [
      match('po1', { stage: 'playoff', slot: 101, teamAId: 'A2', teamBId: 'A3', winnerId: 'A2' }),
      match('k1', { stage: 'knockout', poolId: null, round: 1, slot: 1, teamAId: 'A1', teamBId: 'A2', winnerId: 'A1' }),
      match('o1', { poolId: 'pB', slot: 1, teamAId: 'B1', teamBId: 'A2', winnerId: 'B1' }),
    ];
    // Shuffled on the way in, so the sort has something to do.
    const shuffled = [playedMatches[2]!, ...extras, playedMatches[0]!, playedMatches[1]!];
    const r = computePool({ pool, teams, matches: shuffled, games: playedGames, advancePerPool: 2 });
    expect(r.fixtures.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(r.playoffs.map((m) => m.id)).toEqual(['po1']);
    expect(r.complete).toBe(true);
  });

  it('ignores matches from other pools and knockout matches between the same teams', () => {
    const knockout = match('k1', { stage: 'knockout', poolId: null, round: 1, teamAId: 'A2', teamBId: 'A3', winnerId: 'A2' });
    const otherPoolMatch = match('o1', { poolId: 'pB', teamAId: 'A2', teamBId: 'B1', winnerId: 'A2' });
    const r = computePool({ pool, teams, matches: [...playedMatches, knockout, otherPoolMatch], games: playedGames, advancePerPool: 2 });
    expect(r.rows.map((x) => x.teamId)).toEqual(['A1', 'A2', 'A3']);
    expect(r.rows.map((x) => x.played)).toEqual([2, 2, 2]);
    expect(r.ties).toHaveLength(1);
  });

  it('keeps withdrawn teams in the table and only includes this pool', () => {
    const withdrawn = teams.map((t) => (t.id === 'A3' ? { ...t, withdrawn: true } : t));
    const r = computePool({ pool: otherPool, teams: withdrawn, matches: playedMatches, games: playedGames, advancePerPool: 2 });
    expect(r.rows.map((x) => x.teamId)).toEqual(['B1']);
    const a = computePool({ pool, teams: withdrawn, matches: playedMatches, games: playedGames, advancePerPool: 2 });
    expect(a.rows.map((x) => x.teamId)).toContain('A3');
  });
});

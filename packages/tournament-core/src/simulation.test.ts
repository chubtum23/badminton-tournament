import { describe, it, expect } from 'vitest';
import {
  BADMINTON_DEFAULTS, assignPools, poolMatches, poolStandings, buildBracket,
  advance, rollback, matchResult, liveBoard, type Match, type Game, type TeamRef, type PoolResult,
} from './index';
import { seededRng, idGen } from './testUtils';

/** Team strength = numeric suffix; lower number always wins 15-10, 15-10. */
const strength = (id: string) => Number(id.slice(1));
const playedGames = (): Game[] => [{ gameNo: 1, scoreA: 15, scoreB: 10 }, { gameNo: 2, scoreA: 15, scoreB: 10 }];

function playAll(matches: Match[], games: Record<string, Game[]>): Match[] {
  let state = matches;
  for (;;) {
    const next = state.find((m) => m.status === 'ready');
    if (!next) return state;
    const aStronger = strength(next.teamAId!) < strength(next.teamBId!);
    const g = playedGames();
    if (!aStronger) for (const x of g) [x.scoreA, x.scoreB] = [x.scoreB, x.scoreA];
    const result = matchResult(BADMINTON_DEFAULTS, g);
    if (!result.ok || !result.complete) throw new Error('bad simulated result');
    games[next.id] = g;
    const winner = result.winner === 'a' ? next.teamAId! : next.teamBId!;
    const changed = new Map(advance(state, next.id, winner).map((m) => [m.id, m]));
    state = state.map((m) => changed.get(m.id) ?? m);
  }
}

describe('a 16-team, 4-pool tournament', () => {
  const teams: TeamRef[] = Array.from({ length: 16 }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}` }));
  const newId = idGen();
  const games: Record<string, Game[]> = {};

  const poolIds = ['A', 'B', 'C', 'D'];
  const dealt = assignPools(teams.map((t) => t.id), 4, seededRng(2026));
  let pool = poolIds.flatMap((pid, i) => poolMatches(pid, dealt[i]!, newId));

  it('creates 24 pool matches', () => {
    expect(pool).toHaveLength(24);
    expect(liveBoard(pool, 'pool', poolIds).upNext).toHaveLength(4);
  });

  it('plays every pool match and ranks each pool by strength', () => {
    pool = playAll(pool, games);
    expect(pool.every((m) => m.status === 'done')).toBe(true);
    for (const [i, pid] of poolIds.entries()) {
      const rows = poolStandings(teams.filter((t) => dealt[i]!.includes(t.id)), pool.filter((m) => m.poolId === pid), games);
      const byStrength = [...dealt[i]!].sort((x, y) => strength(x) - strength(y));
      expect(rows.map((r) => r.teamId)).toEqual(byStrength);
      expect(rows[0]!.won).toBe(3);
    }
  });

  it('builds an 8-team bracket and crowns the strongest team', () => {
    const results: PoolResult[] = poolIds.map((pid, i) => ({
      poolId: pid,
      ranked: poolStandings(teams.filter((t) => dealt[i]!.includes(t.id)), pool.filter((m) => m.poolId === pid), games).map((r) => r.teamId),
    }));
    let ko = buildBracket(results, 2, newId);
    expect(ko).toHaveLength(7);
    ko = playAll(ko, games);
    const final = ko.find((m) => m.round === 3)!;
    expect(final.status).toBe('done');
    expect(final.winnerId).toBe('t1');
  });

  it('can roll back a quarter-final and replay it', () => {
    const results: PoolResult[] = poolIds.map((pid, i) => ({
      poolId: pid,
      ranked: poolStandings(teams.filter((t) => dealt[i]!.includes(t.id)), pool.filter((m) => m.poolId === pid), games).map((r) => r.teamId),
    }));
    let ko = playAll(buildBracket(results, 2, idGen('k')), {});
    const qf = ko.find((m) => m.round === 1 && m.teamAId === 't1' || m.round === 1 && m.teamBId === 't1')!;
    const { changed, resetMatchIds } = rollback(ko, qf.id);
    expect(resetMatchIds.sort()).toEqual(ko.filter((m) => m.round! > 1 && [m.teamAId, m.teamBId].includes('t1')).map((m) => m.id).sort());
    const changedMap = new Map(changed.map((m) => [m.id, m]));
    ko = ko.map((m) => changedMap.get(m.id) ?? m);
    // Re-enter the quarter-final with the other team winning this time. The admin
    // resets the match itself to ready (e.g. by clearing its games) before resubmitting;
    // advance() refuses to overwrite a done match's winner otherwise.
    ko = ko.map((m) => (m.id === qf.id ? { ...m, status: 'ready' as const, winnerId: null } : m));
    const loser = qf.teamAId === 't1' ? qf.teamBId! : qf.teamAId!;
    const redo = new Map(advance(ko, qf.id, loser).map((m) => [m.id, m]));
    ko = ko.map((m) => redo.get(m.id) ?? m);
    ko = playAll(ko, {});
    const final = ko.find((m) => m.round === 3)!;
    expect(final.status).toBe('done');
    expect(final.winnerId).not.toBe('t1');
  });
});

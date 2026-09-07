import { describe, it, expect } from 'vitest';
import { makeMatch } from '@tournament/core/src/testUtils';
import { scheduleBoard } from './board';
import type { GameRow, TournamentRow } from '@/lib/db/types';

const tournament = { game_labels: ['Mixed', "Men's", "Ladies'"] } as TournamentRow;

const slot = (over: Partial<GameRow> & { match_id: string; game_no: number }): GameRow => ({
  score_a: null, score_b: null, time_expired: false, court: null, started_at: null, paused_at: null, paused_ms: 0, ...over,
});
const started = (match_id: string, game_no: number, court: number): GameRow =>
  slot({ match_id, game_no, court, started_at: '2026-10-03T09:00:00.000Z' });

const pool = (id: string, poolId: string, matchSlot: number, over = {}) =>
  makeMatch({ id, stage: 'pool', poolId, slot: matchSlot, teamAId: `${id}A`, teamBId: `${id}B`, status: 'ready', ...over });

const board = (input: Partial<Parameters<typeof scheduleBoard>[0]>) => scheduleBoard({
  tournament, matches: [], slots: [], poolOrder: [], stage: 'pool', ...input,
});

describe('scheduleBoard nowPlaying', () => {
  it('lists started, unscored games ordered by court, with their game label', () => {
    const m1 = pool('m1', 'P1', 1);
    const m2 = pool('m2', 'P2', 1);
    const r = board({
      matches: [m1, m2],
      slots: [started('m1', 1, 3), started('m2', 2, 1)],
      poolOrder: ['P1', 'P2'],
    });
    expect(r.nowPlaying.map((g) => [g.match.id, g.slot.game_no, g.slot.court, g.label]))
      .toEqual([['m2', 2, 1, "Men's"], ['m1', 1, 3, 'Mixed']]);
  });

  it('drops a slot once it has a score, even while it still holds a court', () => {
    const m1 = pool('m1', 'P1', 1);
    const scored = { ...started('m1', 1, 1), score_a: 15, score_b: 9 };
    expect(board({ matches: [m1], slots: [scored], poolOrder: ['P1'] }).nowPlaying).toEqual([]);
  });

  it('shows a running playoff game even though playoffs are never offered up next', () => {
    const p = makeMatch({ id: 'x1', stage: 'playoff', slot: 1, teamAId: 'A', teamBId: 'B', status: 'ready' });
    const r = board({ matches: [p], slots: [started('x1', 1, 2), slot({ match_id: 'x1', game_no: 2 })], stage: 'playoff' });
    expect(r.nowPlaying.map((g) => g.match.id)).toEqual(['x1']);
    expect(r.upNext).toEqual([]);
  });
});

describe('scheduleBoard upNext', () => {
  it('offers the earliest waiting game per pool, ordered by poolOrder', () => {
    const a2 = pool('a2', 'P1', 2);
    const a1 = pool('a1', 'P1', 1);
    const b1 = pool('b1', 'P2', 1);
    const r = board({
      matches: [a2, a1, b1],
      slots: [
        slot({ match_id: 'a2', game_no: 1 }),
        slot({ match_id: 'a1', game_no: 2 }),
        slot({ match_id: 'a1', game_no: 1 }),
        slot({ match_id: 'b1', game_no: 1 }),
      ],
      // P2 is ordered ahead of P1, so the board follows the organiser's pool order.
      poolOrder: ['P2', 'P1'],
    });
    expect(r.upNext.map((g) => [g.match.id, g.slot.game_no])).toEqual([['b1', 1], ['a1', 1]]);
  });

  it('skips games that are already on court and matches that are done', () => {
    const a1 = pool('a1', 'P1', 1);
    const a2 = pool('a2', 'P1', 2);
    const done = pool('a0', 'P1', 0, { status: 'done', winnerId: 'a0A' });
    const r = board({
      matches: [done, a1, a2],
      slots: [slot({ match_id: 'a0', game_no: 1 }), started('a1', 1, 1), slot({ match_id: 'a2', game_no: 1 })],
      poolOrder: ['P1'],
    });
    expect(r.upNext.map((g) => g.match.id)).toEqual(['a2']);
  });

  it('offers nothing for a match that is still missing a team', () => {
    const half = makeMatch({ id: 'h1', stage: 'pool', poolId: 'P1', slot: 1, teamAId: 'A', teamBId: null, status: 'pending' });
    expect(board({ matches: [half], slots: [slot({ match_id: 'h1', game_no: 1 })], poolOrder: ['P1'] }).upNext).toEqual([]);
  });

  it('orders knockout rounds by round number rather than by pool', () => {
    const r2 = makeMatch({ id: 'k2', stage: 'knockout', round: 2, slot: 1, teamAId: 'A', teamBId: 'B', status: 'ready' });
    const r1 = makeMatch({ id: 'k1', stage: 'knockout', round: 1, slot: 1, teamAId: 'C', teamBId: 'D', status: 'ready' });
    const r = board({
      matches: [r2, r1],
      slots: [slot({ match_id: 'k2', game_no: 1 }), slot({ match_id: 'k1', game_no: 1 })],
      stage: 'knockout',
    });
    expect(r.upNext.map((g) => g.match.id)).toEqual(['k1', 'k2']);
  });
});

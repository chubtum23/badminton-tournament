import { describe, it, expect } from 'vitest';
import { BADMINTON_DEFAULTS, type Match } from '@tournament/core';
import { planResult, planCourt } from './apply';

const base = (over: Partial<Match> & { id: string }): Match => ({
  stage: 'knockout', poolId: null, round: 1, slot: 1, teamAId: null, teamBId: null, court: null,
  status: 'pending', winnerId: null, nextMatchId: null, nextMatchSide: null, ...over,
});
const s1 = base({ id: 's1', teamAId: 'A', teamBId: 'B', status: 'live', court: 1, nextMatchId: 'f', nextMatchSide: 'a' });
const s2 = base({ id: 's2', slot: 2, teamAId: 'C', teamBId: 'D', status: 'ready', nextMatchId: 'f', nextMatchSide: 'b' });
const f = base({ id: 'f', round: 2 });
const g = (a1: number, b1: number, a2: number, b2: number) => [{ gameNo: 1, scoreA: a1, scoreB: b1 }, { gameNo: 2, scoreA: a2, scoreB: b2 }];

describe('planResult', () => {
  it('completes a live match and fills the next match', () => {
    const r = planResult({ settings: BADMINTON_DEFAULTS, matches: [s1, s2, f], matchId: 's1', games: g(15, 10, 15, 12) });
    if ('error' in r) throw new Error(r.message);
    expect(r.winnerId).toBe('A');
    expect(r.tournamentFinished).toBe(false);
    expect(r.clearGamesFor).toEqual([]);
    expect(r.gamesToWrite).toHaveLength(2);
    expect(r.updates.find((m) => m.id === 's1')).toMatchObject({ status: 'done', winnerId: 'A', court: null });
    expect(r.updates.find((m) => m.id === 'f')).toMatchObject({ teamAId: 'A', status: 'pending' });
  });

  it('rejects an incomplete or invalid set of games', () => {
    const inc = planResult({ settings: BADMINTON_DEFAULTS, matches: [s1, s2, f], matchId: 's1', games: g(15, 10, 10, 15) });
    expect(inc).toMatchObject({ error: 'incomplete' });
    const bad = planResult({ settings: BADMINTON_DEFAULTS, matches: [s1, s2, f], matchId: 's1', games: g(15, 14, 15, 12) });
    expect(bad).toMatchObject({ error: 'invalid_score' });
  });

  it('refuses matches that are pending', () => {
    const r = planResult({ settings: BADMINTON_DEFAULTS, matches: [s1, s2, f], matchId: 'f', games: g(15, 1, 15, 1) });
    expect(r).toMatchObject({ error: 'match_not_editable' });
  });

  it('flags the tournament finished when the final completes', () => {
    const readyFinal = { ...f, teamAId: 'A', teamBId: 'C', status: 'ready' as const };
    const r = planResult({ settings: BADMINTON_DEFAULTS, matches: [readyFinal], matchId: 'f', games: g(15, 1, 15, 1) });
    if ('error' in r) throw new Error(r.message);
    expect(r.tournamentFinished).toBe(true);
  });

  it('edits a done match by rolling back downstream and re-advancing', () => {
    const doneS1 = { ...s1, status: 'done' as const, winnerId: 'A', court: null };
    const doneS2 = { ...s2, status: 'done' as const, winnerId: 'C' };
    const liveFinal = { ...f, teamAId: 'A', teamBId: 'C', status: 'live' as const, court: 2 };
    const r = planResult({ settings: BADMINTON_DEFAULTS, matches: [doneS1, doneS2, liveFinal], matchId: 's1', games: g(10, 15, 10, 15) });
    if ('error' in r) throw new Error(r.message);
    expect(r.winnerId).toBe('B');
    expect(r.clearGamesFor).toEqual(['f']);
    const final = r.updates.find((m) => m.id === 'f');
    expect(final).toMatchObject({ teamAId: 'B', teamBId: 'C', status: 'ready', court: null, winnerId: null });
    expect(r.updates.find((m) => m.id === 's1')).toMatchObject({ status: 'done', winnerId: 'B' });
  });

  it('correcting a semi-final score without changing its winner keeps the final done', () => {
    const doneS1 = { ...s1, status: 'done' as const, winnerId: 'A', court: null };
    const doneS2 = { ...s2, status: 'done' as const, winnerId: 'C' };
    const doneFinal = { ...f, teamAId: 'A', teamBId: 'C', status: 'done' as const, winnerId: 'A', court: null };
    const r = planResult({ settings: BADMINTON_DEFAULTS, matches: [doneS1, doneS2, doneFinal], matchId: 's1', games: g(15, 10, 15, 13) });
    if ('error' in r) throw new Error(r.message);
    expect(r.winnerId).toBe('A');
    expect(r.clearGamesFor).toEqual([]);
    expect(r.terminalStillDone).toBe(true);
  });

  it('flipping a semi-final winner rolls the done final back to ready', () => {
    const doneS1 = { ...s1, status: 'done' as const, winnerId: 'A', court: null };
    const doneS2 = { ...s2, status: 'done' as const, winnerId: 'C' };
    const doneFinal = { ...f, teamAId: 'A', teamBId: 'C', status: 'done' as const, winnerId: 'A', court: null };
    const r = planResult({ settings: BADMINTON_DEFAULTS, matches: [doneS1, doneS2, doneFinal], matchId: 's1', games: g(10, 15, 10, 15) });
    if ('error' in r) throw new Error(r.message);
    expect(r.winnerId).toBe('B');
    expect(r.clearGamesFor).toEqual(['f']);
    const final = r.updates.find((m) => m.id === 'f');
    expect(final).toMatchObject({ teamAId: 'B', teamBId: 'C', status: 'ready', winnerId: null });
    expect(r.terminalStillDone).toBe(false);
  });

  it('completing the final reports it as done and the tournament as finished', () => {
    const readyFinal = { ...f, teamAId: 'A', teamBId: 'C', status: 'ready' as const };
    const r = planResult({ settings: BADMINTON_DEFAULTS, matches: [readyFinal], matchId: 'f', games: g(15, 1, 15, 1) });
    if ('error' in r) throw new Error(r.message);
    expect(r.tournamentFinished).toBe(true);
    expect(r.terminalStillDone).toBe(true);
  });

  it('pool matches complete without a next match', () => {
    const pm = base({ id: 'p1', stage: 'pool', poolId: 'P', round: null, teamAId: 'A', teamBId: 'B', status: 'ready' });
    const r = planResult({ settings: BADMINTON_DEFAULTS, matches: [pm], matchId: 'p1', games: g(15, 3, 15, 3) });
    if ('error' in r) throw new Error(r.message);
    expect(r.updates).toHaveLength(1);
    expect(r.tournamentFinished).toBe(false);
  });
});

describe('planCourt', () => {
  it('moves ready to live with a court, and live back to ready when cleared', () => {
    expect(planCourt([s1, s2], 's2', 2, 4)).toMatchObject({ id: 's2', status: 'live', court: 2 });
    expect(planCourt([s1, s2], 's1', null, 4)).toMatchObject({ id: 's1', status: 'ready', court: null });
  });
  it('moves a live match to another free court', () => {
    expect(planCourt([s1, s2], 's1', 3, 4)).toMatchObject({ id: 's1', status: 'live', court: 3 });
  });
  it('refuses moving a live match onto a court another live match holds', () => {
    const other = { ...s2, status: 'live' as const, court: 2 };
    expect(planCourt([s1, other], 's1', 2, 4)).toMatchObject({ error: expect.stringMatching(/in use/) });
  });
  it('refuses a court in use, an out-of-range court, and a non-ready match', () => {
    expect(planCourt([s1, s2], 's2', 1, 4)).toMatchObject({ error: expect.stringMatching(/in use/) });
    expect(planCourt([s1, s2], 's2', 5, 4)).toMatchObject({ error: expect.stringMatching(/between 1 and 4/) });
    expect(planCourt([s1, s2, f], 'f', 2, 4)).toMatchObject({ error: expect.stringMatching(/not ready/) });
  });
});

import { describe, it, expect } from 'vitest';
import { CLASSIC_BEST_OF_THREE, type Match } from '@tournament/core';
import { decideSubmission, sameGames } from './decide';
import type { SubmissionRow } from '@/lib/db/types';

const match: Match = { id: 'm1', stage: 'pool', poolId: 'P', round: null, slot: 1, teamAId: 'A', teamBId: 'B', court: 1, status: 'live', winnerId: null, decidedBy: 'played', nextMatchId: null, nextMatchSide: null };
const win = [{ gameNo: 1, scoreA: 15, scoreB: 7 }, { gameNo: 2, scoreA: 15, scoreB: 9 }];
const other = [{ gameNo: 1, scoreA: 15, scoreB: 7 }, { gameNo: 2, scoreA: 15, scoreB: 10 }];
const sub = (by: 'team_a' | 'team_b', games = win): SubmissionRow => ({ id: `s-${by}`, match_id: 'm1', submitted_by: by, games, created_at: '2026-09-07T10:00:00Z' });

describe('sameGames', () => {
  it('compares by game number regardless of order', () => {
    expect(sameGames(win, [...win].reverse())).toBe(true);
    expect(sameGames(win, other)).toBe(false);
    expect(sameGames(win, win.slice(0, 1))).toBe(false);
  });
});

describe('decideSubmission', () => {
  it('first submission on a live match is just submitted', () => {
    expect(decideSubmission({ settings: CLASSIC_BEST_OF_THREE, match, side: 'a', games: win, latest: {} })).toEqual({ outcome: 'submitted' });
  });
  it('opponent agreeing confirms', () => {
    const m = { ...match, status: 'submitted' as const };
    expect(decideSubmission({ settings: CLASSIC_BEST_OF_THREE, match: m, side: 'b', games: win, latest: { a: sub('team_a') } })).toEqual({ outcome: 'confirmed' });
  });
  it('opponent disagreeing disputes', () => {
    const m = { ...match, status: 'submitted' as const };
    expect(decideSubmission({ settings: CLASSIC_BEST_OF_THREE, match: m, side: 'b', games: other, latest: { a: sub('team_a') } })).toEqual({ outcome: 'disputed' });
  });
  it('resubmitting by the same side with no opposing submission stays submitted', () => {
    const m = { ...match, status: 'submitted' as const };
    expect(decideSubmission({ settings: CLASSIC_BEST_OF_THREE, match: m, side: 'a', games: other, latest: { a: sub('team_a') } })).toEqual({ outcome: 'submitted' });
  });
  it('a corrected resubmission that now matches the opponent confirms from a disputed state', () => {
    const m = { ...match, status: 'disputed' as const };
    expect(decideSubmission({ settings: CLASSIC_BEST_OF_THREE, match: m, side: 'b', games: win, latest: { a: sub('team_a'), b: sub('team_b', other) } })).toEqual({ outcome: 'confirmed' });
  });
  it('rejects incomplete or invalid games and non-editable matches', () => {
    expect(decideSubmission({ settings: CLASSIC_BEST_OF_THREE, match, side: 'a', games: win.slice(0, 1), latest: {} })).toMatchObject({ error: 'invalid_score' });
    expect(decideSubmission({ settings: CLASSIC_BEST_OF_THREE, match, side: 'a', games: [{ gameNo: 1, scoreA: 15, scoreB: 14 }, win[1]!], latest: {} })).toMatchObject({ error: 'invalid_score' });
    expect(decideSubmission({ settings: CLASSIC_BEST_OF_THREE, match: { ...match, status: 'done' }, side: 'a', games: win, latest: {} })).toMatchObject({ error: 'match_not_editable' });
    expect(decideSubmission({ settings: CLASSIC_BEST_OF_THREE, match: { ...match, status: 'pending', teamBId: null }, side: 'a', games: win, latest: {} })).toMatchObject({ error: 'match_not_editable' });
  });
});

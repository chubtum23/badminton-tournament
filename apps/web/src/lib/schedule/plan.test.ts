import { describe, it, expect } from 'vitest';
import { firstFreeCourt, planGameCourt, planGameStart } from './plan';
import type { GameRow } from '@/lib/db/types';

const slot = (over: Partial<GameRow> & { match_id: string; game_no: number }): GameRow => ({
  score_a: null, score_b: null, time_expired: false, court: null, started_at: null, paused_at: null, paused_ms: 0, ...over,
});
const running = slot({ match_id: 'm1', game_no: 1, court: 1, started_at: '2026-10-03T09:00:00.000Z' });
const idle = slot({ match_id: 'm1', game_no: 2 });
const played = slot({ match_id: 'm1', game_no: 3, score_a: 15, score_b: 9 });

describe('firstFreeCourt', () => {
  it('skips courts held by a running game', () => {
    expect(firstFreeCourt([running], 4)).toBe(2);
    expect(firstFreeCourt([], 4)).toBe(1);
  });
  it('is null when every court is busy', () => {
    expect(firstFreeCourt([running, slot({ match_id: 'm2', game_no: 1, court: 2, started_at: 'x' })], 2)).toBeNull();
  });
});

describe('planGameCourt', () => {
  it('sends an idle game to a court and starts its clock', () => {
    const r = planGameCourt([running, idle], 'm1', 2, 3, 4);
    expect(r).toMatchObject({ court: 3, paused_at: null, paused_ms: 0 });
    if ('error' in r) throw new Error(r.error);
    expect(typeof r.started_at).toBe('string');
  });
  it('moving a running game to another court keeps its clock', () => {
    const r = planGameCourt([running, idle], 'm1', 1, 2, 4);
    if ('error' in r) throw new Error(r.error);
    expect(r).toEqual({ court: 2, started_at: running.started_at, paused_at: null, paused_ms: 0 });
  });
  it('moving a paused game keeps it paused, so the stoppage is not counted as playing time', () => {
    const paused = { ...running, paused_at: '2026-10-03T09:06:00.000Z', paused_ms: 30_000 };
    const r = planGameCourt([paused, idle], 'm1', 1, 2, 4);
    expect(r).toEqual({ court: 2, started_at: running.started_at, paused_at: paused.paused_at, paused_ms: 30_000 });
  });
  it('taking a game off court clears the clock', () => {
    expect(planGameCourt([running], 'm1', 1, null, 4)).toEqual({ court: null, started_at: null, paused_at: null, paused_ms: 0 });
  });
  it('refuses a busy court, an out of range court, an unknown slot and a played game', () => {
    expect(planGameCourt([running, idle], 'm1', 2, 1, 4)).toEqual({ error: 'court 1 is in use' });
    expect(planGameCourt([running, idle], 'm1', 2, 9, 4)).toEqual({ error: 'court must be between 1 and 4' });
    expect(planGameCourt([running], 'm1', 7, 2, 4)).toEqual({ error: 'unknown game' });
    expect(planGameCourt([played], 'm1', 3, 2, 4)).toEqual({ error: 'that game already has a score' });
  });
});

describe('planGameStart', () => {
  it('starts a game with no court at all, clock running', () => {
    const r = planGameStart([running, idle], 'm1', 2, null, 1);
    expect(r).toMatchObject({ court: null, paused_at: null, paused_ms: 0 });
    if ('error' in r) throw new Error(r.error);
    expect(typeof r.started_at).toBe('string'); // unlike planGameCourt(null), which takes it off
  });

  it('is how a game starts when every court is busy: no court, not a refusal', () => {
    const full = [running, slot({ match_id: 'm2', game_no: 1, court: 2, started_at: 'x' })];
    expect(firstFreeCourt(full, 2)).toBeNull();
    const r = planGameStart([...full, idle], 'm1', 2, firstFreeCourt(full, 2), 2);
    expect('error' in r).toBe(false);
    expect((r as { court: number | null }).court).toBeNull();
  });

  it('keeps the clock of a running game that gives up its court', () => {
    const r = planGameStart([running], 'm1', 1, null, 4);
    expect(r).toMatchObject({ court: null, started_at: running.started_at });
  });

  it('still refuses a court another game is holding, and a scored game', () => {
    expect(planGameStart([running, idle], 'm1', 2, 1, 4)).toEqual({ error: 'court 1 is in use' });
    expect(planGameStart([played], 'm1', 3, null, 4)).toEqual({ error: 'that game already has a score' });
  });
});

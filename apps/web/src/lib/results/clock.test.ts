import { describe, it, expect } from 'vitest';
import { elapsedMs, remainingMs, type ClockState } from './clock';

const T0 = Date.parse('2026-10-03T19:00:00.000Z');
const at = (msAfterStart: number) => new Date(T0 + msAfterStart).toISOString();
const state = (over: Partial<ClockState> = {}): ClockState => ({
  startedAt: at(0), pausedAt: null, pausedMs: 0, capMinutes: 13, ...over,
});

describe('elapsedMs', () => {
  it('counts wall time while running', () => {
    expect(elapsedMs(state(), T0 + 90_000)).toBe(90_000);
  });
  it('freezes at pausedAt while paused', () => {
    const c = state({ pausedAt: at(60_000) });
    expect(elapsedMs(c, T0 + 60_000)).toBe(60_000);
    // Ten more minutes of wall clock pass; play time does not move.
    expect(elapsedMs(c, T0 + 660_000)).toBe(60_000);
  });
  it('ignores a stoppage once resumed', () => {
    // Ran 1 min, stopped for 5 min, then ran another minute of wall time.
    const c = state({ pausedMs: 300_000 });
    expect(elapsedMs(c, T0 + 420_000)).toBe(120_000);
  });
  it('is zero before the match starts', () => {
    expect(elapsedMs(state({ startedAt: null }), T0 + 600_000)).toBe(0);
  });
  it('never goes negative', () => {
    expect(elapsedMs(state(), T0 - 5_000)).toBe(0);
    expect(elapsedMs(state({ pausedMs: 999_000 }), T0 + 1_000)).toBe(0);
  });
});

describe('remainingMs', () => {
  it('counts the cap down while running', () => {
    expect(remainingMs(state(), T0 + 60_000)).toBe(12 * 60_000);
  });
  it('holds still while paused', () => {
    const c = state({ pausedAt: at(60_000) });
    expect(remainingMs(c, T0 + 600_000)).toBe(12 * 60_000);
  });
  it('gives the stoppage back after a resume', () => {
    // Without the 5-minute pause credited, 7 minutes of wall time would leave 6:00.
    const c = state({ pausedMs: 300_000 });
    expect(remainingMs(c, T0 + 420_000)).toBe(11 * 60_000);
  });
  it('floors at zero once expired', () => {
    expect(remainingMs(state(), T0 + 20 * 60_000)).toBe(0);
  });
  it('is null with no cap', () => {
    expect(remainingMs(state({ capMinutes: null }), T0 + 60_000)).toBeNull();
  });
  it('is null before the match starts', () => {
    expect(remainingMs(state({ startedAt: null }), T0 + 60_000)).toBeNull();
  });
});

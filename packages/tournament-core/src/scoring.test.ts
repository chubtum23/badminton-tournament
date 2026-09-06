import { describe, it, expect } from 'vitest';
import { validateGame } from './scoring';
import { BADMINTON_DEFAULTS, type Settings } from './types';

const s = BADMINTON_DEFAULTS; // to 15, win by two, cap 21

describe('validateGame', () => {
  it('accepts a normal win for either side', () => {
    expect(validateGame(s, 15, 11)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(s, 9, 15)).toEqual({ ok: true, winner: 'b' });
  });

  it('rejects when nobody reached the target', () => {
    expect(validateGame(s, 14, 12)).toEqual({ ok: false, reason: 'winner must reach 15' });
  });

  it('rejects ties, negatives and non-integers', () => {
    expect(validateGame(s, 15, 15).ok).toBe(false);
    expect(validateGame(s, -1, 15).ok).toBe(false);
    expect(validateGame(s, 15.5, 10).ok).toBe(false);
  });

  it('enforces win by two at the target', () => {
    expect(validateGame(s, 15, 14)).toEqual({ ok: false, reason: 'must win by two' });
    expect(validateGame(s, 16, 14)).toEqual({ ok: true, winner: 'a' });
  });

  it('requires exactly a two-point lead past the target', () => {
    expect(validateGame(s, 17, 14)).toEqual({ ok: false, reason: 'a game past 15 ends on a two-point lead' });
    expect(validateGame(s, 20, 18)).toEqual({ ok: true, winner: 'a' });
  });

  it('lets the cap end the game with a one-point lead', () => {
    expect(validateGame(s, 21, 20)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(s, 19, 21)).toEqual({ ok: true, winner: 'b' });
    expect(validateGame(s, 21, 14)).toEqual({ ok: false, reason: 'a game past 15 ends on a two-point lead' });
    expect(validateGame(s, 22, 20)).toEqual({ ok: false, reason: 'scores cannot exceed 21' });
  });

  it('without win-by-two the game ends exactly at the target', () => {
    const noWbt: Settings = { ...s, winByTwo: false, maxPoints: null };
    expect(validateGame(noWbt, 15, 14)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(noWbt, 16, 14)).toEqual({ ok: false, reason: 'game ends at 15' });
  });

  it('when the cap equals the target any lead wins', () => {
    const capped: Settings = { ...s, maxPoints: 15 };
    expect(validateGame(capped, 15, 14)).toEqual({ ok: true, winner: 'a' });
  });

  it('with no cap the game can run long', () => {
    const uncapped: Settings = { ...s, maxPoints: null };
    expect(validateGame(uncapped, 30, 28)).toEqual({ ok: true, winner: 'a' });
    expect(validateGame(uncapped, 30, 29)).toEqual({ ok: false, reason: 'a game past 15 ends on a two-point lead' });
  });
});

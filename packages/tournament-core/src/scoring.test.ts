import { describe, it, expect } from 'vitest';
import { validateGame, matchResult } from './scoring';
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

describe('matchResult', () => {
  const g = (gameNo: number, scoreA: number, scoreB: number) => ({ gameNo, scoreA, scoreB });

  it('is incomplete with no games', () => {
    expect(matchResult(s, [])).toEqual({ ok: true, complete: false, winner: null, gamesA: 0, gamesB: 0 });
  });

  it('declares a straight-games winner', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 15, 12)])).toEqual({
      ok: true, complete: true, winner: 'a', gamesA: 2, gamesB: 0,
    });
  });

  it('is incomplete at one game each', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 12, 15)])).toEqual({
      ok: true, complete: false, winner: null, gamesA: 1, gamesB: 1,
    });
  });

  it('declares a three-game winner', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 12, 15), g(3, 13, 15)])).toMatchObject({
      ok: true, complete: true, winner: 'b', gamesA: 1, gamesB: 2,
    });
  });

  it('rejects a game after the match is decided', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 15, 12), g(3, 15, 1)])).toEqual({
      ok: false, reason: 'extra game after the match was decided',
    });
  });

  it('rejects out-of-sequence game numbers', () => {
    expect(matchResult(s, [g(1, 15, 8), g(3, 15, 12)])).toEqual({
      ok: false, reason: 'expected game 2 but got game 3',
    });
  });

  it('reports which game is invalid', () => {
    expect(matchResult(s, [g(1, 15, 8), g(2, 15, 14)])).toEqual({
      ok: false, reason: 'game 2: must win by two',
    });
  });

  it('accepts games in any input order', () => {
    expect(matchResult(s, [g(2, 15, 12), g(1, 15, 8)])).toMatchObject({ complete: true, winner: 'a' });
  });

  it('honours gamesPerMatch = 1', () => {
    const single: Settings = { ...s, gamesPerMatch: 1 };
    expect(matchResult(single, [g(1, 15, 8)])).toMatchObject({ complete: true, winner: 'a' });
    expect(matchResult(single, [g(1, 15, 8), g(2, 15, 8)]).ok).toBe(false);
  });
});

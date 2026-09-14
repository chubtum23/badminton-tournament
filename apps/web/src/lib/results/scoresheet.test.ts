import { describe, it, expect } from 'vitest';
import type { Settings } from '@tournament/core';
import { replay, validStart, type Side } from './scoresheet';

const settings = { gamesPerMatch: 3, pointsPerGame: 21, maxPoints: 30, winByTwo: true, timeCapMinutes: null, playAllGames: true } as Settings;
const start = { server: 0, receiver: 2 };
const times = (n: number, side: Side): Side[] => Array.from({ length: n }, () => side);

describe('replay', () => {
  it('starts 0-0 with the server in the right court', () => {
    const s = replay(settings, start, []);
    expect(s).toMatchObject({ scoreA: 0, scoreB: 0, server: 0, court: 'right', receiver: 2, finished: false });
  });

  it('keeps the same server, switching courts, while the serving side wins', () => {
    const s = replay(settings, start, ['a', 'a']);
    expect(s.cells.map((c) => c.row)).toEqual([0, 0]);
    expect(s).toMatchObject({ scoreA: 2, server: 0, court: 'right' });
    // After one point the server is on the left, facing the receiver's left-court player.
    expect(replay(settings, start, ['a'])).toMatchObject({ court: 'left', receiver: 3 });
  });

  it('hands the serve to the player in the court matching the new score', () => {
    // B wins at 0-0 → B has 1 (odd) → left court, where the receiver's partner stands.
    expect(replay(settings, start, ['b'])).toMatchObject({ server: 3, court: 'left' });
    // A goes 1-0 (players swap), B wins → B on 1 → left → player 3.
    // Then A wins it back onto 2 → even → right, which is player 1 after the earlier swap.
    const s = replay(settings, start, ['a', 'b', 'a']);
    expect(s.cells.map((c) => c.row)).toEqual([0, 3, 1]);
    expect(s).toMatchObject({ scoreA: 2, scoreB: 1, server: 1, court: 'right' });
  });

  it('writes each score in the next server’s row', () => {
    const s = replay(settings, start, ['b', 'b']);
    expect(s.cells).toEqual([
      { row: 3, score: 1, interval: false },
      { row: 3, score: 2, interval: false },
    ]);
  });

  it('marks the interval once, when the leader reaches 11', () => {
    const s = replay(settings, start, [...times(11, 'a'), ...times(11, 'b')]);
    expect(s.cells.filter((c) => c.interval)).toHaveLength(1);
    expect(s.cells[10]!.interval).toBe(true);
  });

  it('finishes at 21 and ignores rallies after that', () => {
    const s = replay(settings, start, [...times(21, 'a'), 'b']);
    expect(s).toMatchObject({ scoreA: 21, scoreB: 0, finished: true, winner: 'a' });
    expect(s.cells).toHaveLength(21);
  });

  it('plays on past 20-all until a two-point lead', () => {
    const deuce = [...times(20, 'a'), ...times(20, 'b')];
    expect(replay(settings, start, [...deuce, 'a']).finished).toBe(false);
    expect(replay(settings, start, [...deuce, 'a', 'a'])).toMatchObject({ finished: true, winner: 'a', scoreA: 22 });
  });
});

describe('validStart', () => {
  it('needs the server and receiver on opposite sides', () => {
    expect(validStart({ server: 1, receiver: 3 })).toBe(true);
    expect(validStart({ server: 0, receiver: 1 })).toBe(false);
    expect(validStart({ server: 4, receiver: 2 })).toBe(false);
  });
});

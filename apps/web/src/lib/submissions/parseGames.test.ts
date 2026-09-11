import { describe, it, expect } from 'vitest';
import { parseGameRows, parseGamesForm } from './parseGames';

const fd = (e: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(e)) f.set(k, v);
  return f;
};

const labels = ['Mixed doubles #1', 'Mixed doubles #2', "Men's doubles"];
const label = (n: number) => labels[n - 1]!;

describe('parseGamesForm', () => {
  it('reads every filled row and the time flag, ignoring trailing blank rows', () => {
    expect(parseGamesForm(fd({ game1a: '15', game1b: '9', game2a: ' 12 ', game2b: '10', game2x: 'on', game3a: '', game3b: '' }), 3, label))
      .toEqual({ ok: true, games: [
        { gameNo: 1, scoreA: 15, scoreB: 9, timeExpired: false },
        { gameNo: 2, scoreA: 12, scoreB: 10, timeExpired: true },
      ] });
  });

  it('refuses a half-filled row instead of reading the blank as 0', () => {
    expect(parseGamesForm(fd({ game1a: '15', game1b: '9', game2a: '15', game2b: '' }), 3, label))
      .toEqual({ ok: false, message: 'Enter both scores for Mixed doubles #2', gameNo: 2 });
    expect(parseGamesForm(fd({ game1a: '', game1b: '7' }), 3, label))
      .toEqual({ ok: false, message: 'Enter both scores for Mixed doubles #1', gameNo: 1 });
  });

  it('refuses a skipped row that has a filled one after it', () => {
    expect(parseGamesForm(fd({ game1a: '15', game1b: '9', game3a: '15', game3b: '3' }), 3, label))
      .toEqual({ ok: false, message: 'Enter the scores for Mixed doubles #2', gameNo: 2 });
  });

  it('reads nothing entered as no games, which the rules then call incomplete', () => {
    expect(parseGamesForm(fd({}), 3, label)).toEqual({ ok: true, games: [] });
  });
});

describe('parseGameRows', () => {
  it('falls back to "Game n" without labels, and runs over any reader', () => {
    const vals: Record<string, string> = { game1a: '15' };
    expect(parseGameRows((f) => vals[f] ?? '', 3)).toEqual({ ok: false, message: 'Enter both scores for Game 1', gameNo: 1 });
  });
});

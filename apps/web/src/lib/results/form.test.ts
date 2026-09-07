import { describe, it, expect } from 'vitest';
import { gamesFromForm } from './form';

const fd = (e: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(e)) f.set(k, v);
  return f;
};

describe('gamesFromForm', () => {
  it('reads scores and the time-expired flag, stopping at the first blank pair', () => {
    expect(gamesFromForm(fd({ game1a: '11', game1b: '8', game1x: 'on', game2a: '', game2b: '' }), 3))
      .toEqual([{ gameNo: 1, scoreA: 11, scoreB: 8, timeExpired: true }]);
    expect(gamesFromForm(fd({ game1a: '15', game1b: '9' }), 1))
      .toEqual([{ gameNo: 1, scoreA: 15, scoreB: 9, timeExpired: false }]);
  });
});

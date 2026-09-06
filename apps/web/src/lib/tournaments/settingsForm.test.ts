import { describe, it, expect } from 'vitest';
import { parseSettingsForm, slugify } from './settingsForm';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe('parseSettingsForm', () => {
  it('parses a valid form', () => {
    const r = parseSettingsForm(fd({ gamesPerMatch: '3', pointsPerGame: '15', winByTwo: 'on', maxPoints: '21', courtCount: '4', advancePerPool: '2' }));
    expect(r).toEqual({ ok: true, value: { gamesPerMatch: 3, pointsPerGame: 15, winByTwo: true, maxPoints: 21, courtCount: 4, advancePerPool: 2 } });
  });
  it('treats a blank cap as null and a missing checkbox as false', () => {
    const r = parseSettingsForm(fd({ gamesPerMatch: '1', pointsPerGame: '21', maxPoints: '', courtCount: '1', advancePerPool: '1' }));
    expect(r).toEqual({ ok: true, value: { gamesPerMatch: 1, pointsPerGame: 21, winByTwo: false, maxPoints: null, courtCount: 1, advancePerPool: 1 } });
  });
  it('reports rule problems from validateSettings', () => {
    const r = parseSettingsForm(fd({ gamesPerMatch: '2', pointsPerGame: '15', maxPoints: '11', courtCount: '2', advancePerPool: '2' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(['gamesPerMatch must be a positive odd integer', 'maxPoints must be null or at least pointsPerGame']);
  });
  it('reports non-numeric input and bad court or advance counts', () => {
    const r = parseSettingsForm(fd({ gamesPerMatch: 'x', pointsPerGame: '15', maxPoints: '', courtCount: '0', advancePerPool: '9' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain('courtCount must be between 1 and 50');
    if (!r.ok) expect(r.problems).toContain('advancePerPool must be between 1 and 8');
  });
});

describe('slugify', () => {
  it('lowercases, hyphenates and trims to 40 chars', () => {
    expect(slugify('Spring Club Night 2026!')).toBe('spring-club-night-2026');
    expect(slugify('  --Hello--  ')).toBe('hello');
    expect(slugify('a'.repeat(50))).toHaveLength(40);
  });
});

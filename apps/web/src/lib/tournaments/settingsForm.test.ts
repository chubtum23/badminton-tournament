import { describe, it, expect } from 'vitest';
import { parseSettingsForm, slugify } from './settingsForm';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

/** The club-format pool fields, as the setup form posts them. */
const poolFields = {
  pool_gamesPerMatch: '1', pool_pointsPerGame: '15', pool_maxPoints: '', pool_timeCap: '13',
  courtCount: '4', advancePerPool: '2',
};

describe('parseSettingsForm', () => {
  it('parses the club default with ko_same on, leaving knockout null', () => {
    const r = parseSettingsForm(fd({ ...poolFields, ko_same: 'on' }));
    expect(r).toEqual({
      ok: true,
      value: {
        pool: { gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13 },
        knockout: null, courtCount: 4, advancePerPool: 2, startsAt: null, venue: '',
      },
    });
  });

  it('parses a distinct knockout stage when ko_same is off', () => {
    const r = parseSettingsForm(fd({
      ...poolFields, ko_gamesPerMatch: '3', ko_pointsPerGame: '15', ko_winByTwo: 'on', ko_maxPoints: '21', ko_timeCap: '20',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.knockout).toEqual({ gamesPerMatch: 3, pointsPerGame: 15, winByTwo: true, maxPoints: 21, timeCapMinutes: 20 });
  });

  it('treats a blank knockout clock as no clock', () => {
    const r = parseSettingsForm(fd({
      ...poolFields, ko_gamesPerMatch: '1', ko_pointsPerGame: '21', ko_maxPoints: '', ko_timeCap: '',
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.knockout).toEqual({ gamesPerMatch: 1, pointsPerGame: 21, winByTwo: false, maxPoints: null, timeCapMinutes: null });
  });

  it('treats a blank pool cap as null and a missing checkbox as false', () => {
    const r = parseSettingsForm(fd({ ...poolFields, pool_timeCap: '', ko_same: 'on' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pool).toEqual({ gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: null });
  });

  it('reports pool rule problems from validateSettings, prefixed', () => {
    const r = parseSettingsForm(fd({ ...poolFields, pool_gamesPerMatch: '2', pool_maxPoints: '11', ko_same: 'on' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(['pool: gamesPerMatch must be a positive odd integer', 'pool: maxPoints must be null or at least pointsPerGame']);
  });

  it('reports knockout rule problems separately', () => {
    const r = parseSettingsForm(fd({ ...poolFields, ko_gamesPerMatch: '2', ko_pointsPerGame: '15', ko_maxPoints: '', ko_timeCap: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(['knockout: gamesPerMatch must be a positive odd integer']);
  });

  it('reports bad court or advance counts', () => {
    const r = parseSettingsForm(fd({ ...poolFields, courtCount: '0', advancePerPool: '9', ko_same: 'on' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain('courtCount must be between 1 and 50');
    if (!r.ok) expect(r.problems).toContain('advancePerPool must be between 1 and 8');
  });

  it('converts a datetime-local start to an ISO string and a blank one to null', () => {
    const r = parseSettingsForm(fd({ ...poolFields, ko_same: 'on', startsAt: '2026-10-03T19:00' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.startsAt).toBe(new Date('2026-10-03T19:00').toISOString());
    const blank = parseSettingsForm(fd({ ...poolFields, ko_same: 'on', startsAt: '' }));
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.value.startsAt).toBeNull();
  });

  it('rejects an unparseable start', () => {
    const r = parseSettingsForm(fd({ ...poolFields, ko_same: 'on', startsAt: 'next tuesday' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain('start date/time is not valid');
  });

  it('trims the venue and rejects one over 120 characters', () => {
    const r = parseSettingsForm(fd({ ...poolFields, ko_same: 'on', venue: '  Northcote Leisure Centre  ' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.venue).toBe('Northcote Leisure Centre');
    const long = parseSettingsForm(fd({ ...poolFields, ko_same: 'on', venue: 'x'.repeat(121) }));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.problems).toContain('venue must be at most 120 characters');
  });
});

describe('slugify', () => {
  it('lowercases, hyphenates and trims to 40 chars', () => {
    expect(slugify('Spring Club Night 2026!')).toBe('spring-club-night-2026');
    expect(slugify('  --Hello--  ')).toBe('hello');
    expect(slugify('a'.repeat(50))).toHaveLength(40);
  });
});

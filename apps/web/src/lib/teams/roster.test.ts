import { describe, it, expect } from 'vitest';
import { keptPathFrom, pairNames, parseRosterForm, parseSignupForm, photoBlobFrom, rosterErrorMessage, rosterOf } from './roster';
import type { TeamWithPlayers } from '@/lib/db/queries';

const team: TeamWithPlayers = {
  id: 't1', tournament_id: 'x', name: 'Smashers', tagline: '', colour: '#2563eb', description: '', seed: null,
  pool_id: null, pool_order: 0, withdrawn: false, pool_rank_override: null, photo_path: null,
  players: [
    { id: 'p1', tournament_id: 'x', name: 'Alex', gender: 'male', role: 'mixed1' },
    { id: 'p2', tournament_id: 'x', name: 'Ben', gender: 'male', role: 'mixed2' },
    { id: 'p3', tournament_id: 'x', name: 'Priya', gender: 'female', role: 'woman' },
  ],
};

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe('pairNames', () => {
  it('names the pair for each game number', () => {
    expect(pairNames(team, 1)).toBe('Alex & Priya');
    expect(pairNames(team, 2)).toBe('Ben & Priya');
    expect(pairNames(team, 3)).toBe('Alex & Ben');
  });
  it('is null for an incomplete roster', () => {
    expect(pairNames({ ...team, players: team.players.slice(0, 2) }, 1)).toBeNull();
  });
  it('rosterOf maps rows to the core shape', () => {
    expect(rosterOf(team)[0]).toEqual({ id: 'p1', name: 'Alex', gender: 'male', role: 'mixed1' });
  });
});

describe('parseRosterForm', () => {
  it('trims the three names', () => {
    expect(parseRosterForm(fd({ mixed1: ' Alex ', mixed2: 'Ben', woman: 'Priya' })))
      .toEqual({ ok: true, value: { mixed1: 'Alex', mixed2: 'Ben', woman: 'Priya' } });
  });
  it('requires every box', () => {
    const r = parseRosterForm(fd({ mixed1: 'Alex', mixed2: '', woman: 'Priya' }));
    expect(r).toEqual({ ok: false, problems: ['Man playing Mixed #2 is required'] });
  });
  it('caps names at 60 characters', () => {
    const r = parseRosterForm(fd({ mixed1: 'a'.repeat(61), mixed2: 'Ben', woman: 'Priya' }));
    expect(r).toEqual({ ok: false, problems: ['Man playing Mixed #1 must be at most 60 characters'] });
  });
});

describe('parseSignupForm', () => {
  it('combines profile, roster and join code', () => {
    const r = parseSignupForm(fd({ name: 'Smashers', tagline: '', colour: '#DC2626', description: 'hi', mixed1: 'Alex', mixed2: 'Ben', woman: 'Priya', joinCode: ' club ' }));
    expect(r).toEqual({ ok: true, value: { name: 'Smashers', tagline: '', colour: '#dc2626', description: 'hi', mixed1: 'Alex', mixed2: 'Ben', woman: 'Priya', joinCode: 'club' } });
  });
  it('reports profile and roster problems together', () => {
    const r = parseSignupForm(fd({ name: '', colour: '#dc2626', mixed1: 'Alex', mixed2: 'Ben', woman: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(['name must be 1-40 characters', 'Woman is required']);
  });
});

describe('photoBlobFrom', () => {
  const file = (name: string, size: number) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

  it('picks up the file the picker put in the form', () => {
    const f = new FormData();
    f.set('photo_file', file('team.jpg', 1000));
    const blob = photoBlobFrom(f);
    expect(blob).not.toBeNull();
    expect(blob!.name).toBe('team.jpg');
  });

  it('treats a zero-byte file as no file', () => {
    const f = new FormData();
    f.set('photo_file', file('empty.jpg', 0));
    expect(photoBlobFrom(f)).toBeNull();
  });

  it('is null when the form has no file', () => {
    expect(photoBlobFrom(new FormData())).toBeNull();
  });
});

describe('keptPathFrom', () => {
  it('keeps the path the form names', () => {
    const f = new FormData();
    f.set('photo', 'tid/abc123.jpg');
    expect(keptPathFrom(f)).toBe('tid/abc123.jpg');
  });

  it('treats an empty value as removed', () => {
    const f = new FormData();
    f.set('photo', '');
    expect(keptPathFrom(f)).toBeNull();
  });

  it('is null when the form has no path', () => {
    expect(keptPathFrom(new FormData())).toBeNull();
  });
});

describe('rosterErrorMessage', () => {
  it('maps the database codes to sentences', () => {
    expect(rosterErrorMessage('duplicate_name')).toBe('That team name is already taken in this tournament');
    expect(rosterErrorMessage('bad_join_code')).toBe('That join code is not right');
    expect(rosterErrorMessage('signup_closed')).toBe('Sign-ups are closed');
    expect(rosterErrorMessage('invalid_input')).toBe('Check the names and try again');
    expect(rosterErrorMessage('stale_state')).toBe('The draw is locked, so teams cannot change');
    expect(rosterErrorMessage('something else')).toBe('something else');
  });
});

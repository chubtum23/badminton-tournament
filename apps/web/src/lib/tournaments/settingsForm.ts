import { validateSettings, type Settings } from '@tournament/core';

export interface SettingsInput {
  pool: Settings;
  /** null = same as pool */
  knockout: Settings | null;
  courtCount: number;
  advancePerPool: number;
  /** ISO string, or null when the organiser left the date blank. */
  startsAt: string | null;
  /** Trimmed; '' means "no venue". */
  venue: string;
}

function int(fd: FormData, key: string): number {
  const raw = String(fd.get(key) ?? '').trim();
  return raw === '' ? Number.NaN : Number(raw);
}

function stageSettings(fd: FormData, prefix: 'pool' | 'ko'): Settings {
  const cap = String(fd.get(`${prefix}_maxPoints`) ?? '').trim();
  const clock = String(fd.get(`${prefix}_timeCap`) ?? '').trim();
  return {
    gamesPerMatch: int(fd, `${prefix}_gamesPerMatch`),
    pointsPerGame: int(fd, `${prefix}_pointsPerGame`),
    winByTwo: fd.get(`${prefix}_winByTwo`) !== null,
    maxPoints: cap === '' ? null : Number(cap),
    timeCapMinutes: clock === '' ? null : Number(clock),
  };
}

export function parseSettingsForm(fd: FormData): { ok: true; value: SettingsInput } | { ok: false; problems: string[] } {
  const pool = stageSettings(fd, 'pool');
  // The "knockout is the same as the pool stage" checkbox: when it is on, the ko_* inputs on the
  // form are ignored entirely and the tournament stores no overrides.
  const knockout = fd.get('ko_same') !== null ? null : stageSettings(fd, 'ko');
  const rawStart = String(fd.get('startsAt') ?? '').trim();
  const startsAt = rawStart === '' || Number.isNaN(Date.parse(rawStart)) ? null : new Date(rawStart).toISOString();
  const venue = String(fd.get('venue') ?? '').trim();
  const value: SettingsInput = {
    pool, knockout, courtCount: int(fd, 'courtCount'), advancePerPool: int(fd, 'advancePerPool'), startsAt, venue,
  };
  const problems = validateSettings(pool).map((p) => `pool: ${p}`);
  if (knockout) problems.push(...validateSettings(knockout).map((p) => `knockout: ${p}`));
  if (rawStart !== '' && Number.isNaN(Date.parse(rawStart))) problems.push('start date/time is not valid');
  if (venue.length > 120) problems.push('venue must be at most 120 characters');
  if (!Number.isInteger(value.courtCount) || value.courtCount < 1 || value.courtCount > 50) problems.push('courtCount must be between 1 and 50');
  if (!Number.isInteger(value.advancePerPool) || value.advancePerPool < 1 || value.advancePerPool > 8) problems.push('advancePerPool must be between 1 and 8');
  return problems.length ? { ok: false, problems } : { ok: true, value };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

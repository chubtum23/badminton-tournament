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
  /** One name per pool game, in game order. */
  labels: string[];
}

function int(fd: FormData, key: string): number {
  const raw = String(fd.get(key) ?? '').trim();
  return raw === '' ? Number.NaN : Number(raw);
}

/**
 * `playAllGames` is a format decision for the whole event, so it is read once from the pool
 * checkbox and the knockout simply inherits it; the form has no knockout control for it.
 */
function stageSettings(fd: FormData, prefix: 'pool' | 'ko'): Settings {
  const cap = String(fd.get(`${prefix}_maxPoints`) ?? '').trim();
  const clock = String(fd.get(`${prefix}_timeCap`) ?? '').trim();
  return {
    gamesPerMatch: int(fd, `${prefix}_gamesPerMatch`),
    pointsPerGame: int(fd, `${prefix}_pointsPerGame`),
    winByTwo: fd.get(`${prefix}_winByTwo`) !== null,
    maxPoints: cap === '' ? null : Number(cap),
    timeCapMinutes: clock === '' ? null : Number(clock),
    playAllGames: fd.get('pool_playAllGames') !== null,
  };
}

/**
 * The per-game names, one field per pool game. A gamesPerMatch that is not a sane game count is
 * already reported by validateSettings, so no labels are read for it rather than reporting twice.
 */
function gameLabels(fd: FormData, gamesPerMatch: number): string[] {
  const count = Number.isInteger(gamesPerMatch) && gamesPerMatch >= 1 && gamesPerMatch <= 9 ? gamesPerMatch : 0;
  return Array.from({ length: count }, (_, i) => String(fd.get(`gameLabel${i + 1}`) ?? '').trim());
}

export function parseSettingsForm(fd: FormData): { ok: true; value: SettingsInput } | { ok: false; problems: string[] } {
  const pool = stageSettings(fd, 'pool');
  // The "knockout is the same as the pool stage" checkbox: when it is on, the ko_* inputs on the
  // form are ignored entirely and the tournament stores no overrides.
  const knockout = fd.get('ko_same') !== null ? null : stageSettings(fd, 'ko');
  const rawStart = String(fd.get('startsAt') ?? '').trim();
  const startsAt = rawStart === '' || Number.isNaN(Date.parse(rawStart)) ? null : new Date(rawStart).toISOString();
  const venue = String(fd.get('venue') ?? '').trim();
  const labels = gameLabels(fd, pool.gamesPerMatch);
  const value: SettingsInput = {
    pool, knockout, courtCount: int(fd, 'courtCount'), advancePerPool: int(fd, 'advancePerPool'), startsAt, venue, labels,
  };
  const problems = validateSettings(pool).map((p) => `pool: ${p}`);
  if (labels.some((l) => l === '')) problems.push('game labels must not be blank');
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

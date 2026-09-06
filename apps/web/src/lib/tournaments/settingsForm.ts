import { validateSettings } from '@tournament/core';

export interface SettingsInput {
  gamesPerMatch: number;
  pointsPerGame: number;
  winByTwo: boolean;
  maxPoints: number | null;
  courtCount: number;
  advancePerPool: number;
}

function int(fd: FormData, key: string): number {
  const raw = String(fd.get(key) ?? '').trim();
  return raw === '' ? Number.NaN : Number(raw);
}

export function parseSettingsForm(fd: FormData): { ok: true; value: SettingsInput } | { ok: false; problems: string[] } {
  const rawCap = String(fd.get('maxPoints') ?? '').trim();
  const value: SettingsInput = {
    gamesPerMatch: int(fd, 'gamesPerMatch'),
    pointsPerGame: int(fd, 'pointsPerGame'),
    winByTwo: fd.get('winByTwo') !== null,
    maxPoints: rawCap === '' ? null : Number(rawCap),
    courtCount: int(fd, 'courtCount'),
    advancePerPool: int(fd, 'advancePerPool'),
  };
  const problems = validateSettings(value);
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

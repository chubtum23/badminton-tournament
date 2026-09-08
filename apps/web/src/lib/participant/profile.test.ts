import { describe, it, expect } from 'vitest';
import { parseProfileForm } from './profile';

function fd(e: Record<string, string>): FormData { const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f; }

describe('parseProfileForm', () => {
  it('accepts a valid profile and trims whitespace', () => {
    expect(parseProfileForm(fd({ name: '  Smash Bros ', tagline: ' we smash ', colour: '#AbCdEf' })))
      .toEqual({ ok: true, value: { name: 'Smash Bros', tagline: 'we smash', colour: '#abcdef', description: '' } });
  });
  it('rejects empty or long names, long taglines and bad colours', () => {
    const r = parseProfileForm(fd({ name: '', tagline: 'x'.repeat(81), colour: 'red' }));
    expect(r).toEqual({ ok: false, problems: ['name must be 1-40 characters', 'tagline must be at most 80 characters', 'colour must look like #1a2b3c'] });
    expect(parseProfileForm(fd({ name: 'n'.repeat(41), tagline: '', colour: '#123456' })).ok).toBe(false);
  });
  it('caps the description at 400 characters', () => {
    const f = new FormData(); f.set('name', 'A'); f.set('colour', '#123456'); f.set('description', 'x'.repeat(401));
    expect(parseProfileForm(f)).toEqual({ ok: false, problems: ['description must be at most 400 characters'] });
  });
});

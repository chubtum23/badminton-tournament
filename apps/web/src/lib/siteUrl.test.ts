import { describe, expect, it, vi } from 'vitest';
import { siteOrigin } from './siteUrl';

const hdrs = (h: Record<string, string>) => new Headers(h);

describe('siteOrigin', () => {
  it('prefers the configured site URL over the request host', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://real.example.com/');
    expect(siteOrigin(hdrs({ 'x-forwarded-host': 'evil.example.com' }))).toBe('https://real.example.com');
    vi.unstubAllEnvs();
  });

  it('falls back to http for a localhost request', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(siteOrigin(hdrs({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    vi.unstubAllEnvs();
  });

  it('falls back to https for any other host', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(siteOrigin(hdrs({ host: 'club.example.com' }))).toBe('https://club.example.com');
    vi.unstubAllEnvs();
  });
});

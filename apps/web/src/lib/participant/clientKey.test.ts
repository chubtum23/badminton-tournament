import { describe, it, expect } from 'vitest';
import { clientKeyFrom } from './clientKey';

const h = (init: Record<string, string>) => new Headers(init);

describe('clientKeyFrom', () => {
  it('prefers the trusted proxy header', () => {
    expect(clientKeyFrom(h({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1, 198.51.100.4' }))).toBe('203.0.113.7');
  });

  it('takes the last x-forwarded-for entry, the one the nearest proxy appended', () => {
    expect(clientKeyFrom(h({ 'x-forwarded-for': '1.2.3.4, 198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('ignores client-supplied spoofed entries ahead of the proxy entry', () => {
    expect(clientKeyFrom(h({ 'x-forwarded-for': 'evil, evil, evil, 198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('handles a single-entry x-forwarded-for', () => {
    expect(clientKeyFrom(h({ 'x-forwarded-for': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('trims whitespace and skips empty entries', () => {
    expect(clientKeyFrom(h({ 'x-forwarded-for': '1.2.3.4,  198.51.100.4 ,' }))).toBe('198.51.100.4');
    expect(clientKeyFrom(h({ 'x-real-ip': '  203.0.113.7  ' }))).toBe('203.0.113.7');
  });

  it('falls back to a single shared bucket with no proxy headers', () => {
    expect(clientKeyFrom(h({}))).toBe('local');
    expect(clientKeyFrom(h({ 'x-real-ip': '   ', 'x-forwarded-for': ' , ' }))).toBe('local');
  });
});

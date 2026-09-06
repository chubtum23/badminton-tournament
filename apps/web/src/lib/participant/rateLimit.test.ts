import { describe, it, expect, beforeEach } from 'vitest';
import { allow, resetRateLimit } from './rateLimit';

describe('allow', () => {
  beforeEach(() => resetRateLimit());
  it('permits up to the limit within the window and refuses the next', () => {
    for (let i = 0; i < 3; i++) expect(allow('ip1', 3, 1000, 1000 + i)).toBe(true);
    expect(allow('ip1', 3, 1000, 1004)).toBe(false);
  });
  it('forgets hits older than the window', () => {
    for (let i = 0; i < 3; i++) expect(allow('ip1', 3, 1000, 1000 + i)).toBe(true);
    expect(allow('ip1', 3, 1000, 2001)).toBe(true);
  });
  it('tracks keys independently', () => {
    for (let i = 0; i < 3; i++) allow('ip1', 3, 1000, 1000);
    expect(allow('ip2', 3, 1000, 1000)).toBe(true);
  });
});

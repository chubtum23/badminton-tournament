import { describe, it, expect } from 'vitest';
import { BADMINTON_DEFAULTS } from '@tournament/core';

describe('web workspace', () => {
  it('can import the rules package', () => {
    expect(BADMINTON_DEFAULTS.pointsPerGame).toBe(15);
  });
});

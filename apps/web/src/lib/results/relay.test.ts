import { describe, expect, it } from 'vitest';
import { justSwapped, relayLeg, swapPoints } from './relay';

describe('relay legs', () => {
  it('swaps at each third of the target', () => {
    expect(swapPoints(45)).toEqual([15, 30]);
    expect(swapPoints(63)).toEqual([21, 42]);
  });

  it('moves on when either team reaches the swap point', () => {
    expect(relayLeg(45, 14, 14)).toBe(1);
    expect(relayLeg(45, 15, 3)).toBe(2);
    expect(relayLeg(45, 9, 15)).toBe(2);
    expect(relayLeg(45, 29, 30)).toBe(3);
    expect(relayLeg(63, 20, 20)).toBe(1);
    expect(relayLeg(63, 21, 0)).toBe(2);
    expect(relayLeg(63, 42, 41)).toBe(3);
  });

  it('flags the swap only on the rally that reached it', () => {
    const fifteen = Array.from({ length: 15 }, () => 'a' as const);
    expect(justSwapped(45, fifteen.slice(0, 14))).toBe(false);
    expect(justSwapped(45, fifteen)).toBe(true);
    expect(justSwapped(45, [...fifteen, 'b'])).toBe(false);
    // The other team reaching 15 later is not a second swap: the leg already moved on.
    expect(justSwapped(45, [...fifteen, ...Array.from({ length: 15 }, () => 'b' as const)])).toBe(false);
    expect(justSwapped(45, Array.from({ length: 30 }, () => 'b' as const))).toBe(true);
  });

  it('does not flag the winning point', () => {
    expect(justSwapped(3, ['a', 'a', 'a'])).toBe(false);
  });
});

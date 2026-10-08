import type { Side } from './scoresheet';

/**
 * A relay game: one game to a target, played in three legs. The pairs swap the moment either team
 * reaches a third of the target (15 and 30 in a game to 45): Mixed #1, then Mixed #2, then the men's
 * doubles — the pairs of games 1, 2 and 3 of a pool meeting. Next point wins at target-1 all.
 */
export const RELAY_LEGS = [1, 2, 3] as const;
export type RelayLeg = typeof RELAY_LEGS[number];

/** The scores at which the pairs swap, e.g. [15, 30] for a game to 45. */
export function swapPoints(target: number): [number, number] {
  const step = target / 3;
  return [step, 2 * step];
}

/** The leg being played at this score: decided by whichever team is further on. */
export function relayLeg(target: number, scoreA: number, scoreB: number): RelayLeg {
  const hi = Math.max(scoreA, scoreB);
  const [first, second] = swapPoints(target);
  return hi < first ? 1 : hi < second ? 2 : 3;
}

/** The last rally took a team to a swap point: the pairs change now, before the next rally. */
export function justSwapped(target: number, rallies: readonly Side[]): boolean {
  if (rallies.length === 0) return false;
  let a = 0;
  for (const r of rallies) if (r === 'a') a++;
  const b = rallies.length - a;
  const last = rallies[rallies.length - 1]!;
  const before = relayLeg(target, a - (last === 'a' ? 1 : 0), b - (last === 'b' ? 1 : 0));
  const after = relayLeg(target, a, b);
  return after > before && Math.max(a, b) < target;
}

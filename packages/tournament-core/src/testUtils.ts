import type { Match, Rng } from './types';

/** mulberry32: small deterministic PRNG for tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a Match with sensible defaults; override any field. */
export function makeMatch(overrides: Partial<Match> & { id: string }): Match {
  return {
    stage: 'pool',
    poolId: null,
    round: null,
    slot: 1,
    teamAId: null,
    teamBId: null,
    court: null,
    status: 'pending',
    winnerId: null,
    decidedBy: 'played',
    nextMatchId: null,
    nextMatchSide: null,
    ...overrides,
  };
}

/** Sequential id generator: m1, m2, m3 ... */
export function idGen(prefix = 'm'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

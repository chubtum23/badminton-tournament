import type { Rng } from './types';

/** Fisher-Yates shuffle. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Shuffle all teams and deal them round-robin into pools.
 * Seeds are deliberately ignored: placement is random.
 */
export function assignPools(teamIds: readonly string[], poolCount: number, rng: Rng): string[][] {
  if (!Number.isInteger(poolCount) || poolCount < 1) throw new Error('poolCount must be a positive integer');
  if (poolCount > teamIds.length) throw new Error('more pools than teams');
  const pools: string[][] = Array.from({ length: poolCount }, () => []);
  shuffle(teamIds, rng).forEach((id, i) => pools[i % poolCount]!.push(id));
  return pools;
}

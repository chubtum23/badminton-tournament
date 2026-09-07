import type { Match, Rng } from './types';

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

export interface Pairing {
  slot: number;
  teamAId: string;
  teamBId: string;
}

/**
 * Circle-method round robin. With n teams (n even, or n+1 with a bye) there are
 * n-1 rounds of n/2 matches; within a round no team appears twice.
 */
export function roundRobin(teamIds: readonly string[]): Pairing[] {
  if (teamIds.length < 2) return [];
  const ids: (string | null)[] = [...teamIds];
  if (ids.length % 2 === 1) ids.push(null); // bye marker
  const n = ids.length;
  const fixed = ids[0]!;
  let rest = ids.slice(1);
  const out: Pairing[] = [];
  let slot = 1;

  for (let round = 0; round < n - 1; round++) {
    const ring = [fixed, ...rest];
    for (let i = 0; i < n / 2; i++) {
      const x = ring[i]!;
      const y = ring[n - 1 - i]!;
      if (x === null || y === null) continue;
      out.push(round % 2 === 0 ? { slot, teamAId: x, teamBId: y } : { slot, teamAId: y, teamBId: x });
      slot++;
    }
    rest = [rest[rest.length - 1]!, ...rest.slice(0, -1)];
  }
  return out;
}

/** Pool matches are ready as soon as they are created: both teams are known. */
export function poolMatches(poolId: string, teamIds: readonly string[], newId: () => string): Match[] {
  return roundRobin(teamIds).map((p) => ({
    id: newId(),
    stage: 'pool',
    poolId,
    round: null,
    slot: p.slot,
    teamAId: p.teamAId,
    teamBId: p.teamBId,
    court: null,
    status: 'ready',
    winnerId: null,
    decidedBy: 'played',
    nextMatchId: null,
    nextMatchSide: null,
  }));
}

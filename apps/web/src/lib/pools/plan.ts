import { assignPools, poolMatches, type Match, type Rng } from '@tournament/core';

export interface PlannedPool {
  name: string;
  position: number;
  teamIds: string[];
}

export function planPools(teamIds: string[], poolCount: number, rng: Rng): { pools: PlannedPool[] } {
  const dealt = assignPools(teamIds, poolCount, rng);
  return {
    pools: dealt.map((teamIdsInPool, i) => ({
      name: `Pool ${String.fromCharCode(65 + i)}`,
      position: i + 1,
      teamIds: teamIdsInPool,
    })),
  };
}

export function planLock(pools: { id: string; teamIds: string[] }[], newId: () => string): Match[] {
  return pools.flatMap((p) => poolMatches(p.id, p.teamIds, newId));
}

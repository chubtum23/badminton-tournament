import type { Match, Stage } from './types';

export interface LiveBoard {
  nowPlaying: Match[];
  upNext: Match[];
}

export function liveBoard(matches: readonly Match[], stage: Stage, poolOrder: readonly string[] = []): LiveBoard {
  const nowPlaying = matches
    .filter((m) => m.status === 'live')
    .sort((x, y) => (x.court ?? Number.MAX_SAFE_INTEGER) - (y.court ?? Number.MAX_SAFE_INTEGER));

  const groupKey = (m: Match) => (stage === 'pool' ? `pool:${m.poolId}` : `round:${m.round}`);
  const best = new Map<string, Match>();
  for (const m of matches) {
    if (m.stage !== stage || m.status !== 'ready' || m.court !== null) continue;
    const current = best.get(groupKey(m));
    if (!current || m.slot < current.slot) best.set(groupKey(m), m);
  }

  const poolRank = (poolId: string | null) => {
    const idx = poolOrder.indexOf(poolId ?? '');
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };

  const upNext = [...best.values()].sort((x, y) =>
    stage === 'pool' ? poolRank(x.poolId) - poolRank(y.poolId) : (x.round ?? 0) - (y.round ?? 0),
  );

  return { nowPlaying, upNext };
}

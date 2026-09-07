import type { Match } from './types';

export interface PoolResult {
  poolId: string;
  /** Team ids in finishing order, best first. */
  ranked: string[];
}

export function bracketSize(qualifiers: number): number {
  let size = 2;
  while (size < qualifiers) size *= 2;
  return size;
}

/** Standard bracket seed layout: 1 and 2 in opposite halves, 1 v size in round one, etc. */
export function bracketOrder(size: number): number[] {
  if (size < 1 || (size & (size - 1)) !== 0) throw new Error('size must be a power of two');
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

function firstRoundClashes(seeds: readonly string[], poolOf: ReadonlyMap<string, string>): number {
  const order = bracketOrder(bracketSize(seeds.length));
  let clashes = 0;
  for (let i = 0; i < order.length; i += 2) {
    const x = seeds[order[i]! - 1];
    const y = seeds[order[i + 1]! - 1];
    if (x !== undefined && y !== undefined && poolOf.get(x) === poolOf.get(y)) clashes++;
  }
  return clashes;
}

/**
 * Global seed order: all pool winners (in pool order), then all runners-up, and so on.
 * Within each rank tier the pool order is rotated by rank*shift; the smallest shift
 * that yields no same-pool first-round match is used. Seeds beyond the qualifier
 * count are byes, so pool winners receive byes first.
 */
export function seedQualifiers(pools: readonly PoolResult[], advancePerPool: number): string[] {
  const poolCount = pools.length;
  const poolOf = new Map<string, string>();
  for (const p of pools) {
    if (p.ranked.length < advancePerPool) throw new Error(`pool ${p.poolId} has fewer than ${advancePerPool} teams`);
    for (const id of p.ranked.slice(0, advancePerPool)) poolOf.set(id, p.poolId);
  }

  const build = (shift: number): string[] => {
    const out: string[] = [];
    for (let rank = 0; rank < advancePerPool; rank++) {
      for (let i = 0; i < poolCount; i++) {
        const p = pools[(i + rank * shift) % poolCount]!;
        out.push(p.ranked[rank]!);
      }
    }
    return out;
  };

  let best = build(0);
  let bestClashes = firstRoundClashes(best, poolOf);
  for (let shift = 1; shift < poolCount && bestClashes > 0; shift++) {
    const candidate = build(shift);
    const clashes = firstRoundClashes(candidate, poolOf);
    if (clashes < bestClashes) { best = candidate; bestClashes = clashes; }
  }
  return best;
}

export function buildBracket(pools: readonly PoolResult[], advancePerPool: number, newId: () => string): Match[] {
  const seeds = seedQualifiers(pools, advancePerPool);
  if (seeds.length < 2) throw new Error('need at least two qualifiers');
  const size = bracketSize(seeds.length);
  const order = bracketOrder(size);
  const rounds = Math.log2(size);

  const byRound: Match[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    byRound.push(
      Array.from({ length: count }, (_, i): Match => ({
        id: newId(), stage: 'knockout', poolId: null, round: r, slot: i + 1,
        teamAId: null, teamBId: null, status: 'pending',
        winnerId: null, decidedBy: 'played', nextMatchId: null, nextMatchSide: null,
      })),
    );
  }

  for (let r = 0; r < rounds - 1; r++) {
    byRound[r]!.forEach((m, i) => {
      m.nextMatchId = byRound[r + 1]![Math.floor(i / 2)]!.id;
      m.nextMatchSide = i % 2 === 0 ? 'a' : 'b';
    });
  }

  const all = byRound.flat();
  const byId = new Map(all.map((m) => [m.id, m]));
  const first = byRound[0]!;
  first.forEach((m, i) => {
    m.teamAId = seeds[order[2 * i]! - 1] ?? null;
    m.teamBId = seeds[order[2 * i + 1]! - 1] ?? null;
  });

  for (const m of first) {
    if (m.teamAId && m.teamBId) { m.status = 'ready'; continue; }
    const only = m.teamAId ?? m.teamBId;
    if (!only || !m.nextMatchId) continue;
    m.status = 'done';
    // Nobody played: the lone entrant walks through. 'bye' keeps it out of the awarded/forfeit
    // wording on the cards and in the bracket.
    m.decidedBy = 'bye';
    m.winnerId = only;
    const next = byId.get(m.nextMatchId)!;
    if (m.nextMatchSide === 'a') next.teamAId = only;
    else next.teamBId = only;
  }
  for (let r = 1; r < rounds; r++) {
    for (const m of byRound[r]!) if (m.teamAId && m.teamBId) m.status = 'ready';
  }
  return all;
}

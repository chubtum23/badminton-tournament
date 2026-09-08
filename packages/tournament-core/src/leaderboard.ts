import type { StandingRow } from './standings';

export interface LeaderboardRow extends StandingRow {
  poolName: string;
  /** Dense rank: equal keys share a number and the next distinct key takes the next number. */
  overallRank: number;
}

const key = (r: StandingRow) => [r.points, r.gamesWon, r.pointDiff] as const;

function compare(a: StandingRow, b: StandingRow): number {
  const ka = key(a), kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
  return a.name.localeCompare(b.name);
}

/**
 * Every team of every pool in one table, pool-stage points only (it takes pool standings as its
 * input, so knockout results cannot leak in). Withdrawn teams keep their numbers but sort last.
 */
export function overallLeaderboard(
  pools: readonly { poolName: string; rows: readonly StandingRow[] }[],
  withdrawnIds: readonly string[] = [],
): LeaderboardRow[] {
  const withdrawn = new Set(withdrawnIds);
  const all = pools.flatMap((p) => p.rows.map((r) => ({ ...r, poolName: p.poolName })));
  const active = all.filter((r) => !withdrawn.has(r.teamId)).sort(compare);
  const out = all.filter((r) => withdrawn.has(r.teamId)).sort(compare);
  // Dense ranks compare the numeric keys only: two teams level on everything share a number even
  // though `compare` breaks their order by name. A withdrawn team can only share one with another
  // withdrawn team: the active/withdrawn boundary always starts a new rank.
  const sameKey = (p: StandingRow, q: StandingRow) => key(p).every((v, n) => v === key(q)[n]);
  const ranked: LeaderboardRow[] = [];
  let rank = 0;
  for (const [i, r] of [...active, ...out].entries()) {
    const prev = ranked[i - 1];
    const same = prev !== undefined && sameKey(prev, r) && withdrawn.has(r.teamId) === withdrawn.has(prev.teamId);
    if (!same) rank += 1;
    ranked.push({ ...r, overallRank: rank });
  }
  return ranked;
}

import { buildBracket, poolStandings, type Game, type Match, type PoolResult, type TeamRef } from '@tournament/core';

export interface KnockoutInput {
  pools: { id: string; name: string }[];
  teams: TeamRef[];
  /** teamId -> poolId */
  teamPoolIds: Record<string, string>;
  matches: Match[];
  games: Record<string, Game[]>;
  advancePerPool: number;
  newId: () => string;
}

export function planKnockout(input: KnockoutInput): { matches: Match[]; qualifiers: PoolResult[] } | { error: string } {
  const poolMatches = input.matches.filter((m) => m.stage === 'pool');
  const unfinished = poolMatches.filter((m) => m.status !== 'done').length;
  if (unfinished > 0) return { error: `${unfinished} pool match${unfinished === 1 ? '' : 'es'} still to play` };

  const qualifiers: PoolResult[] = [];
  for (const pool of input.pools) {
    const teams = input.teams.filter((t) => input.teamPoolIds[t.id] === pool.id);
    if (teams.length < input.advancePerPool) return { error: `${pool.name} has ${teams.length} teams but ${input.advancePerPool} must advance` };
    const rows = poolStandings(teams, poolMatches.filter((m) => m.poolId === pool.id), input.games);
    qualifiers.push({ poolId: pool.id, ranked: rows.map((r) => r.teamId).slice(0, input.advancePerPool) });
  }
  return { matches: buildBracket(qualifiers, input.advancePerPool, input.newId), qualifiers };
}

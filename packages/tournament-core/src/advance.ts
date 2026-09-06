import type { Match } from './types';

/**
 * Complete a match and push the winner into the linked next match.
 * Returns new copies of every match that changed (1 or 2 matches).
 */
export function advance(matches: readonly Match[], matchId: string, winnerId: string): Match[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const match = byId.get(matchId);
  if (!match) throw new Error(`unknown match ${matchId}`);
  if (winnerId !== match.teamAId && winnerId !== match.teamBId) throw new Error('winner is not in this match');
  if (match.status === 'done' && match.winnerId !== null && match.winnerId !== winnerId) {
    throw new Error('match is already done; roll it back before re-entering a different winner');
  }

  const completed: Match = { ...match, status: 'done', winnerId, court: null };
  const changed: Match[] = [completed];

  if (match.nextMatchId) {
    const next = byId.get(match.nextMatchId);
    if (!next) throw new Error(`unknown next match ${match.nextMatchId}`);
    const filled: Match = { ...next };
    if (match.nextMatchSide === 'a') filled.teamAId = winnerId;
    else if (match.nextMatchSide === 'b') filled.teamBId = winnerId;
    else throw new Error('match has a next match but no next match side');
    if (filled.teamAId && filled.teamBId && filled.status === 'pending') filled.status = 'ready';
    changed.push(filled);
  }
  return changed;
}

export interface RollbackResult {
  /** Downstream matches that changed, as new objects. */
  changed: Match[];
  /** Downstream matches that were past 'ready' and lose their games and submissions. */
  resetMatchIds: string[];
}

/**
 * Undo the downstream effects of a match's current winner so its result can be re-entered.
 * Recurses through every match the old winner had reached.
 */
export function rollback(matches: readonly Match[], matchId: string): RollbackResult {
  const working = new Map(matches.map((m) => [m.id, { ...m }]));
  const match = working.get(matchId);
  if (!match) throw new Error(`unknown match ${matchId}`);

  const changed = new Map<string, Match>();
  const resetMatchIds: string[] = [];

  const clearDownstream = (from: Match): void => {
    const winner = from.winnerId;
    if (!winner || !from.nextMatchId) return;
    const next = working.get(from.nextMatchId);
    if (!next) return;
    if (next.teamAId !== winner && next.teamBId !== winner) return;

    if (next.status === 'done') clearDownstream(next);
    if (next.status !== 'pending' && next.status !== 'ready') resetMatchIds.push(next.id);

    if (next.teamAId === winner) next.teamAId = null;
    else next.teamBId = null;
    next.winnerId = null;
    next.court = null;
    next.status = 'pending';
    changed.set(next.id, next);
  };

  clearDownstream(match);
  return { changed: [...changed.values()], resetMatchIds };
}

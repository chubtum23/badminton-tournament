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

  const completed: Match = { ...match, status: 'done', winnerId, court: null };
  const changed: Match[] = [completed];

  if (match.nextMatchId) {
    const next = byId.get(match.nextMatchId);
    if (!next) throw new Error(`unknown next match ${match.nextMatchId}`);
    const filled: Match = { ...next };
    if (match.nextMatchSide === 'a') filled.teamAId = winnerId;
    else filled.teamBId = winnerId;
    if (filled.teamAId && filled.teamBId && filled.status === 'pending') filled.status = 'ready';
    changed.push(filled);
  }
  return changed;
}

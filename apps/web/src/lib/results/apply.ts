import { advance, matchResult, rollback, winnerTeamId, type Game, type Match, type Settings } from '@tournament/core';

export interface ResultPlan {
  /** Matches to upsert (new objects). */
  updates: Match[];
  /** The confirmed games for the edited match. */
  gamesToWrite: Game[];
  /** Match ids whose games must be deleted because their result was rolled back. */
  clearGamesFor: string[];
  winnerId: string;
  tournamentFinished: boolean;
}

export type ResultError = { error: 'invalid_score' | 'match_not_editable' | 'incomplete'; message: string };

const EDITABLE: ReadonlySet<Match['status']> = new Set(['ready', 'live', 'submitted', 'disputed', 'done']);

export function planResult(input: { settings: Settings; matches: Match[]; matchId: string; games: Game[] }): ResultPlan | ResultError {
  const { settings, matchId, games } = input;
  const match = input.matches.find((m) => m.id === matchId);
  if (!match || !EDITABLE.has(match.status) || !match.teamAId || !match.teamBId) {
    return { error: 'match_not_editable', message: 'This match cannot take a result yet' };
  }
  const result = matchResult(settings, games);
  if (!result.ok) return { error: 'invalid_score', message: result.reason };
  if (!result.complete) return { error: 'incomplete', message: 'Enter games until one side has won the match' };
  const winnerId = winnerTeamId(match, result.winner)!;

  let working = input.matches;
  let clearGamesFor: string[] = [];
  const touched = new Map<string, Match>();
  const applyChanges = (changed: Match[]) => {
    const byId = new Map(changed.map((m) => [m.id, m]));
    working = working.map((m) => byId.get(m.id) ?? m);
    for (const m of changed) touched.set(m.id, m);
  };

  if (match.status === 'done' && match.winnerId !== null && match.winnerId !== winnerId) {
    const rb = rollback(working, matchId);
    applyChanges(rb.changed);
    clearGamesFor = rb.resetMatchIds;
  }
  applyChanges(advance(working, matchId, winnerId));

  const completed = touched.get(matchId)!;
  return {
    updates: [...touched.values()],
    gamesToWrite: [...games].sort((x, y) => x.gameNo - y.gameNo),
    clearGamesFor,
    winnerId,
    tournamentFinished: completed.stage === 'knockout' && completed.nextMatchId === null,
  };
}

export function planCourt(matches: Match[], matchId: string, court: number | null, courtCount: number): Match | { error: string } {
  const match = matches.find((m) => m.id === matchId);
  if (!match) return { error: 'unknown match' };
  if (court === null) {
    if (match.status !== 'live') return { error: 'match is not live' };
    return { ...match, court: null, status: 'ready' };
  }
  if (!Number.isInteger(court) || court < 1 || court > courtCount) return { error: `court must be between 1 and ${courtCount}` };
  if (match.status !== 'ready') return { error: 'match is not ready' };
  const busy = matches.find((m) => m.id !== matchId && m.status === 'live' && m.court === court);
  if (busy) return { error: `court ${court} is in use` };
  return { ...match, court, status: 'live' };
}

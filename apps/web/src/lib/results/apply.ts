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
  /** Whether the terminal knockout match (the final) is `done` after this plan is applied. */
  terminalStillDone: boolean;
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

  const outcome = applyWinner(input.matches, match, winnerId);
  return { ...outcome, gamesToWrite: [...games].sort((x, y) => x.gameNo - y.gameNo), winnerId };
}

/**
 * Roll a changed winner back through the bracket, then advance the new one. Shared by
 * `planResult` (a score was entered) and `planAward` (the organiser handed the match over),
 * which differ only in how the winner is decided and whether games are written.
 */
function applyWinner(matches: readonly Match[], match: Match, winnerId: string): Omit<ResultPlan, 'gamesToWrite' | 'winnerId'> {
  let working: Match[] = [...matches];
  let clearGamesFor: string[] = [];
  const touched = new Map<string, Match>();
  const applyChanges = (changed: Match[]) => {
    const byId = new Map(changed.map((m) => [m.id, m]));
    working = working.map((m) => byId.get(m.id) ?? m);
    for (const m of changed) touched.set(m.id, m);
  };

  if (match.status === 'done' && match.winnerId !== null && match.winnerId !== winnerId) {
    const rb = rollback(working, match.id);
    applyChanges(rb.changed);
    clearGamesFor = rb.resetMatchIds;
  }
  applyChanges(advance(working, match.id, winnerId));

  const completed = touched.get(match.id)!;
  const terminal = working.find((m) => m.stage === 'knockout' && m.nextMatchId === null);
  return {
    updates: [...touched.values()],
    clearGamesFor,
    tournamentFinished: completed.stage === 'knockout' && completed.nextMatchId === null,
    terminalStillDone: terminal !== undefined && terminal.status === 'done',
  };
}

/**
 * Hand a match to one side without a score: a walkover, a forfeit or an organiser's decision.
 * The downstream bookkeeping is the same as a scored result, but the match keeps no games.
 */
export function planAward(input: { matches: Match[]; matchId: string; winnerId: string }): ResultPlan | { error: 'match_not_editable'; message: string } {
  const match = input.matches.find((m) => m.id === input.matchId);
  if (!match || !match.teamAId || !match.teamBId || !EDITABLE.has(match.status)) {
    return { error: 'match_not_editable', message: 'This match cannot be awarded yet' };
  }
  if (input.winnerId !== match.teamAId && input.winnerId !== match.teamBId) {
    return { error: 'match_not_editable', message: 'That team is not in this match' };
  }
  return { ...applyWinner(input.matches, match, input.winnerId), gamesToWrite: [], winnerId: input.winnerId };
}

export function planCourt(matches: Match[], matchId: string, court: number | null, courtCount: number): Match | { error: string } {
  const match = matches.find((m) => m.id === matchId);
  if (!match) return { error: 'unknown match' };
  if (court === null) {
    if (match.status !== 'live') return { error: 'match is not live' };
    return { ...match, court: null, status: 'ready' };
  }
  if (!Number.isInteger(court) || court < 1 || court > courtCount) return { error: `court must be between 1 and ${courtCount}` };
  // 'live' is allowed so a match already on court can be moved to a different free court.
  if (match.status !== 'ready' && match.status !== 'live') return { error: 'match is not ready' };
  const busy = matches.find((m) => m.id !== matchId && m.status === 'live' && m.court === court);
  if (busy) return { error: `court ${court} is in use` };
  return { ...match, court, status: 'live' };
}

import { matchResult, type Game, type Match, type Settings } from '@tournament/core';
import type { SubmissionRow } from '@/lib/db/types';

export function sameGames(a: readonly Game[], b: readonly Game[]): boolean {
  if (a.length !== b.length) return false;
  const key = (g: Game) => `${g.gameNo}:${g.scoreA}-${g.scoreB}`;
  const sa = [...a].map(key).sort();
  const sb = [...b].map(key).sort();
  return sa.every((k, i) => k === sb[i]);
}

export type Decision =
  | { outcome: 'submitted' } | { outcome: 'confirmed' } | { outcome: 'disputed' }
  | { error: 'match_not_editable' | 'invalid_score'; message: string };

const SUBMITTABLE: ReadonlySet<Match['status']> = new Set(['ready', 'live', 'submitted', 'disputed']);

/**
 * Spec 5: a team's submission on a ready/live match -> submitted; the opponent's identical
 * submission -> confirmed; a different one -> disputed. Only the latest submission per side counts,
 * so a corrected resubmission can confirm from a disputed state.
 */
export function decideSubmission(input: {
  settings: Settings; match: Match; side: 'a' | 'b'; games: Game[]; latest: { a?: SubmissionRow; b?: SubmissionRow };
}): Decision {
  const { match, side, games, latest } = input;
  if (!SUBMITTABLE.has(match.status) || !match.teamAId || !match.teamBId) {
    return { error: 'match_not_editable', message: 'This match is not open for scores' };
  }
  const result = matchResult(input.settings, games);
  if (!result.ok) return { error: 'invalid_score', message: result.reason };
  if (!result.complete) {
    // Under play-all a 2-0 lead is not a finished meeting, so "until one side has won" would be wrong.
    const message = input.settings.playAllGames
      ? `Enter all ${input.settings.gamesPerMatch} games`
      : 'Enter games until one side has won the match';
    return { error: 'invalid_score', message };
  }
  const theirs = side === 'a' ? latest.b : latest.a;
  if (!theirs) return { outcome: 'submitted' };
  return sameGames(theirs.games, games) ? { outcome: 'confirmed' } : { outcome: 'disputed' };
}

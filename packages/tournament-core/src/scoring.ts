import type { Game, Match, Settings, Side } from './types';

export type GameValidation = { ok: true; winner: Side } | { ok: false; reason: string };

const fail = (reason: string): GameValidation => ({ ok: false, reason });

export function validateGame(s: Settings, scoreA: number, scoreB: number, timeExpired = false): GameValidation {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    return fail('scores must be non-negative whole numbers');
  }
  if (scoreA === scoreB) return fail('a game cannot end in a tie');

  const hi = Math.max(scoreA, scoreB);
  const lo = Math.min(scoreA, scoreB);
  const lead = hi - lo;
  const winner: Side = scoreA > scoreB ? 'a' : 'b';
  const ceiling = s.maxPoints ?? s.pointsPerGame;

  if (timeExpired) {
    if (s.timeCapMinutes === null) return fail('this stage has no time cap');
    if (hi > ceiling) return fail(`scores cannot exceed ${ceiling}`);
    return { ok: true, winner };
  }

  if (hi < s.pointsPerGame) return fail(`winner must reach ${s.pointsPerGame}`);
  if (s.maxPoints !== null && hi > s.maxPoints) return fail(`scores cannot exceed ${s.maxPoints}`);

  if (hi === s.pointsPerGame) {
    const capIsTarget = s.maxPoints === s.pointsPerGame;
    if (s.winByTwo && !capIsTarget && lead < 2) return fail('must win by two');
    return { ok: true, winner };
  }

  // hi > pointsPerGame: only possible in win-by-two mode
  if (!s.winByTwo) return fail(`game ends at ${s.pointsPerGame}`);
  const atCap = s.maxPoints !== null && hi === s.maxPoints;
  if (lead === 2 || (atCap && lead === 1)) return { ok: true, winner };
  return fail(`a game past ${s.pointsPerGame} ends on a two-point lead`);
}

export type MatchResult =
  | { ok: true; complete: boolean; winner: Side | null; gamesA: number; gamesB: number }
  | { ok: false; reason: string };

export function gamesNeeded(s: Settings): number {
  return Math.floor(s.gamesPerMatch / 2) + 1;
}

export function matchResult(s: Settings, games: readonly Game[]): MatchResult {
  const needed = gamesNeeded(s);
  const ordered = [...games].sort((x, y) => x.gameNo - y.gameNo);
  let gamesA = 0;
  let gamesB = 0;

  for (let i = 0; i < ordered.length; i++) {
    const game = ordered[i]!;
    if (game.gameNo !== i + 1) {
      return { ok: false, reason: `expected game ${i + 1} but got game ${game.gameNo}` };
    }
    if (s.playAllGames) {
      if (i >= s.gamesPerMatch) return { ok: false, reason: `expected ${s.gamesPerMatch} games but got ${ordered.length}` };
    } else if (gamesA >= needed || gamesB >= needed) {
      return { ok: false, reason: 'extra game after the match was decided' };
    }
    const v = validateGame(s, game.scoreA, game.scoreB, game.timeExpired ?? false);
    if (!v.ok) return { ok: false, reason: `game ${game.gameNo}: ${v.reason}` };
    if (v.winner === 'a') gamesA++;
    else gamesB++;
  }

  if (s.playAllGames) {
    // Every game is played, so the meeting is only over when the last score is in and it
    // goes to whoever won more of them. An odd gamesPerMatch makes a draw impossible.
    const complete = ordered.length === s.gamesPerMatch;
    const winner: Side | null = !complete ? null : gamesA > gamesB ? 'a' : 'b';
    return { ok: true, complete, winner, gamesA, gamesB };
  }
  const winner: Side | null = gamesA >= needed ? 'a' : gamesB >= needed ? 'b' : null;
  return { ok: true, complete: winner !== null, winner, gamesA, gamesB };
}

/** Map a matchResult winner side to the team occupying that side. */
export function winnerTeamId(match: Pick<Match, 'teamAId' | 'teamBId'>, winner: Side | null): string | null {
  if (winner === null) return null;
  return winner === 'a' ? match.teamAId : match.teamBId;
}

/** Validate a Settings object. Returns a list of human-readable problems; empty means valid. */
export function validateSettings(s: Settings): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(s.gamesPerMatch) || s.gamesPerMatch <= 0 || s.gamesPerMatch % 2 === 0) {
    problems.push('gamesPerMatch must be a positive odd integer');
  }
  if (!Number.isInteger(s.pointsPerGame) || s.pointsPerGame <= 0) {
    problems.push('pointsPerGame must be a positive integer');
  }
  if (s.maxPoints !== null && (!Number.isInteger(s.maxPoints) || s.maxPoints < s.pointsPerGame)) {
    problems.push('maxPoints must be null or at least pointsPerGame');
  }
  if (s.timeCapMinutes !== null && (!Number.isInteger(s.timeCapMinutes) || s.timeCapMinutes <= 0)) {
    problems.push('timeCapMinutes must be null or a positive integer');
  }
  if (s.playAllGames && Number.isInteger(s.gamesPerMatch) && s.gamesPerMatch % 2 === 0) {
    problems.push('playAllGames needs an odd gamesPerMatch so a meeting cannot be drawn');
  }
  return problems;
}

import type { Settings, Side } from './types';

export type GameValidation = { ok: true; winner: Side } | { ok: false; reason: string };

const fail = (reason: string): GameValidation => ({ ok: false, reason });

export function validateGame(s: Settings, scoreA: number, scoreB: number): GameValidation {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    return fail('scores must be non-negative whole numbers');
  }
  if (scoreA === scoreB) return fail('a game cannot end in a tie');

  const hi = Math.max(scoreA, scoreB);
  const lo = Math.min(scoreA, scoreB);
  const lead = hi - lo;
  const winner: Side = scoreA > scoreB ? 'a' : 'b';

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

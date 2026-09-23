import type { GameRow } from '@/lib/db/types';

const isRunning = (g: GameRow) => g.started_at !== null && g.score_a === null;

/**
 * The lowest court no running game is holding, or null when they are all busy.
 *
 * Null is not a refusal: a game can start without a court (see planGameStart). Courts are a
 * convenience for pointing people at the right net, not a limit on how many games may be under
 * way — a hall can always find another net, and the organiser should never be told to wait.
 */
export function firstFreeCourt(slots: readonly GameRow[], courtCount: number): number | null {
  const busy = new Set(slots.filter(isRunning).map((g) => g.court));
  for (let c = 1; c <= courtCount; c++) if (!busy.has(c)) return c;
  return null;
}

export type CourtPlan = { court: number | null; started_at: string | null; paused_at: string | null; paused_ms: number };

/**
 * Starting a game, with a court or without one. A court of null here means "playing, court not
 * named": the clock starts either way, and any number of games can be under way at once.
 *
 * This is the difference between it and planGameCourt, where null means "take it off court".
 */
export function planGameStart(
  slots: readonly GameRow[], matchId: string, gameNo: number, court: number | null, courtCount: number, now = new Date().toISOString(),
): CourtPlan | { error: string } {
  if (court !== null) return planGameCourt(slots, matchId, gameNo, court, courtCount, now);
  const slot = slots.find((g) => g.match_id === matchId && g.game_no === gameNo);
  if (!slot) return { error: 'unknown game' };
  if (slot.score_a !== null) return { error: 'that game already has a score' };
  // Already running: it keeps its clock and simply gives up its court.
  return slot.started_at
    ? { court: null, started_at: slot.started_at, paused_at: slot.paused_at, paused_ms: slot.paused_ms }
    : { court: null, started_at: now, paused_at: null, paused_ms: 0 };
}

/**
 * Where one game goes next. Sending an idle game to a court starts its clock; moving a game
 * that is already running keeps the clock it has, so a court change does not hand a team
 * extra time. Taking it off court throws the clock away, because the game will start again.
 */
export function planGameCourt(
  slots: readonly GameRow[], matchId: string, gameNo: number, court: number | null, courtCount: number, now = new Date().toISOString(),
): CourtPlan | { error: string } {
  const slot = slots.find((g) => g.match_id === matchId && g.game_no === gameNo);
  if (!slot) return { error: 'unknown game' };
  if (slot.score_a !== null) return { error: 'that game already has a score' };
  if (court === null) return { court: null, started_at: null, paused_at: null, paused_ms: 0 };
  if (!Number.isInteger(court) || court < 1 || court > courtCount) return { error: `court must be between 1 and ${courtCount}` };
  const holder = slots.find((g) => isRunning(g) && g.court === court && !(g.match_id === matchId && g.game_no === gameNo));
  if (holder) return { error: `court ${court} is in use` };
  // A paused game moved to another court stays paused: clearing paused_at here would count the
  // whole stoppage so far as playing time.
  return slot.started_at
    ? { court, started_at: slot.started_at, paused_at: slot.paused_at, paused_ms: slot.paused_ms }
    : { court, started_at: now, paused_at: null, paused_ms: 0 };
}

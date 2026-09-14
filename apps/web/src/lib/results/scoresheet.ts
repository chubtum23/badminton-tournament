import { validateGame, type Settings } from '@tournament/core';

/**
 * The rally-by-rally tally behind the on-screen score sheet, modelled on the BWF umpire's sheet.
 *
 * The sheet has one row per player — side A's two, then side B's two — and one column per rally.
 * After each rally the winning side's new score is written in the row of the player who serves
 * next, so the sheet reads as both the score and the service order. Before the first rally the
 * server is marked S and the receiver R.
 *
 * Doubles service follows the laws: the server's side serves from the right court on an even score
 * and the left on an odd one. A side that wins its own serve swaps courts and the same player serves
 * again; a side that wins the receiver's serve does not move, and whichever of its players stands in
 * the court matching its new score serves.
 *
 * Players are numbered 0-1 for side A and 2-3 for side B; a player's partner is `i ^ 1`.
 */
export type Side = 'a' | 'b';

export interface SheetStart {
  /** The player serving the first rally. */
  server: number;
  /** The player receiving it; must be on the other side. */
  receiver: number;
}

export interface SheetCell {
  /** The player whose row the score is written in: the next server. */
  row: number;
  score: number;
  /** This rally took the leader to the interval score (11 in a 21-point game). */
  interval: boolean;
}

export interface SheetState {
  cells: SheetCell[];
  scoreA: number;
  scoreB: number;
  /** Who serves the next rally, and from which court. */
  server: number;
  court: 'right' | 'left';
  /** The side receiving the next rally, and its player in the diagonal court. */
  receiver: number;
  /** True once the score is a valid finished game; further rallies are refused. */
  finished: boolean;
  winner: Side | null;
}

export const sideOf = (player: number): Side => (player < 2 ? 'a' : 'b');

export function validStart(start: SheetStart): boolean {
  const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n <= 3;
  return inRange(start.server) && inRange(start.receiver) && sideOf(start.server) !== sideOf(start.receiver);
}

/** Replays every rally from the start. The tally is short (a game is at most ~60 rallies). */
export function replay(settings: Settings, start: SheetStart, rallies: readonly Side[]): SheetState {
  // right[side] / left[side]: which player stands in that court of that side.
  const right: Record<Side, number> = { a: 0, b: 2 };
  const left: Record<Side, number> = { a: 1, b: 3 };
  const s = sideOf(start.server), r = sideOf(start.receiver);
  right[s] = start.server; left[s] = start.server ^ 1;
  right[r] = start.receiver; left[r] = start.receiver ^ 1;

  const score: Record<Side, number> = { a: 0, b: 0 };
  let server = start.server;
  let finished = false;
  let intervalDone = false;
  const intervalAt = Math.ceil(settings.pointsPerGame / 2);
  const cells: SheetCell[] = [];

  for (const w of rallies) {
    if (finished) break;
    score[w]++;
    if (sideOf(server) === w) {
      [right[w], left[w]] = [left[w], right[w]];
    } else {
      server = score[w] % 2 === 0 ? right[w] : left[w];
    }
    const interval = !intervalDone && score[w] === intervalAt && Math.max(score.a, score.b) === intervalAt;
    if (interval) intervalDone = true;
    cells.push({ row: server, score: score[w], interval });
    finished = validateGame(settings, score.a, score.b).ok;
  }

  const serving = sideOf(server);
  const receiving: Side = serving === 'a' ? 'b' : 'a';
  const even = score[serving] % 2 === 0;
  return {
    cells,
    scoreA: score.a,
    scoreB: score.b,
    server,
    court: even ? 'right' : 'left',
    receiver: even ? right[receiving] : left[receiving],
    finished,
    winner: finished ? (score.a > score.b ? 'a' : 'b') : null,
  };
}

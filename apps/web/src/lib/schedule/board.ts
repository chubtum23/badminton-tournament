import type { Match, Stage } from '@tournament/core';
import type { GameRow, TournamentRow } from '@/lib/db/types';
import { gameLabel } from '@/lib/db/mappers';

export interface ScheduledGame { match: Match; slot: GameRow; label: string }
export interface Board { nowPlaying: ScheduledGame[]; upNext: ScheduledGame[] }

const isRunning = (g: GameRow) => g.started_at !== null && g.score_a === null;
const isWaiting = (g: GameRow) => g.started_at === null && g.score_a === null;

/**
 * What is on court and what should go on next, at the level of individual games. This
 * replaces the rules package's old match-level board: a court now holds one game, not a
 * whole meeting.
 */
export function scheduleBoard(input: {
  tournament: TournamentRow; matches: readonly Match[]; slots: readonly GameRow[]; poolOrder: readonly string[]; stage: Stage;
}): Board {
  const byId = new Map(input.matches.map((m) => [m.id, m]));
  const label = (n: number) => gameLabel(input.tournament, n);
  const playable = (m: Match | undefined): m is Match =>
    m !== undefined && m.teamAId !== null && m.teamBId !== null && m.status !== 'done';

  const nowPlaying = input.slots
    .filter(isRunning)
    .flatMap((slot) => { const m = byId.get(slot.match_id); return m ? [{ match: m, slot, label: label(slot.game_no) }] : []; })
    .sort((x, y) => (x.slot.court ?? Number.MAX_SAFE_INTEGER) - (y.slot.court ?? Number.MAX_SAFE_INTEGER));

  const groupKey = (m: Match) => (input.stage === 'pool' ? `pool:${m.poolId}` : `round:${m.round}`);
  const best = new Map<string, ScheduledGame>();
  for (const slot of input.slots) {
    if (!isWaiting(slot)) continue;
    const m = byId.get(slot.match_id);
    if (!playable(m) || m.stage !== input.stage || m.stage === 'playoff') continue;
    const candidate = { match: m, slot, label: label(slot.game_no) };
    const current = best.get(groupKey(m));
    const earlier = !current
      || m.slot < current.match.slot
      || (m.slot === current.match.slot && slot.game_no < current.slot.game_no);
    if (earlier) best.set(groupKey(m), candidate);
  }

  const poolRank = (poolId: string | null) => {
    const idx = input.poolOrder.indexOf(poolId ?? '');
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  const upNext = [...best.values()].sort((x, y) =>
    input.stage === 'pool' ? poolRank(x.match.poolId) - poolRank(y.match.poolId) : (x.match.round ?? 0) - (y.match.round ?? 0),
  );
  return { nowPlaying, upNext };
}

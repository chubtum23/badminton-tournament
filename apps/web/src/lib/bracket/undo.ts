import type { GameRow, MatchRow } from '@/lib/db/types';

/**
 * Whether taking the knockout down would throw anything away: a knockout game scored or on court,
 * or a knockout match decided by the organiser. A bye is decided by the draw itself, so it does
 * not count — rebuilding the bracket recreates it.
 */
export function knockoutHasPlay(rows: readonly Pick<MatchRow, 'id' | 'stage' | 'status' | 'decided_by'>[], games: readonly Pick<GameRow, 'match_id' | 'score_a' | 'started_at'>[]): boolean {
  const ko = new Set(rows.filter((m) => m.stage === 'knockout').map((m) => m.id));
  return rows.some((m) => m.stage === 'knockout' && m.status === 'done' && m.decided_by !== 'bye')
    || games.some((g) => ko.has(g.match_id) && (g.score_a !== null || g.started_at !== null));
}

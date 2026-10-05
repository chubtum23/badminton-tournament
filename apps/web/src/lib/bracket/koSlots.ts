import type { GameRow, MatchRow } from '@/lib/db/types';

/**
 * The game slots the knockout needs after its games-per-match changes. Only used while nothing in
 * the knockout has been played, so every slot is empty and can be added or dropped freely.
 */
export function koSlotChanges(
  rows: readonly Pick<MatchRow, 'id' | 'stage'>[],
  games: readonly Pick<GameRow, 'match_id' | 'game_no'>[],
  gamesPerMatch: number,
): { matchIds: string[]; insert: { match_id: string; game_no: number }[] } {
  const matchIds = rows.filter((m) => m.stage === 'knockout').map((m) => m.id);
  const have = new Set(games.map((g) => `${g.match_id}:${g.game_no}`));
  const insert = matchIds.flatMap((id) => Array.from({ length: gamesPerMatch }, (_, i) => ({ match_id: id, game_no: i + 1 })))
    .filter((s) => !have.has(`${s.match_id}:${s.game_no}`));
  return { matchIds, insert };
}

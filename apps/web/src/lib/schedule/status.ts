import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listGames } from '@/lib/db/queries';

/**
 * A meeting is live while any of its games is on court or already scored, and ready again
 * when none is. Completion is not decided here: that happens in saveGameScore, which has the
 * full result and can advance the bracket.
 */
export async function syncMatchStatus(sb: SupabaseClient, tournamentId: string, matchId: string): Promise<void> {
  const slots = (await listGames(sb, tournamentId)).filter((g) => g.match_id === matchId);
  const active = slots.some((g) => g.started_at !== null || g.score_a !== null);
  await sb.from('matches').update({ status: active ? 'live' : 'ready' })
    .eq('id', matchId).in('status', ['ready', 'live']);
}

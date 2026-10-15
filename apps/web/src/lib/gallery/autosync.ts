import 'server-only';
import { createServiceSupabase } from '@/lib/supabase/service';
import { syncGallery } from './sync';

const STALE_MS = 10 * 60 * 1000;

/**
 * Keeps a gallery in step with Drive without anyone pressing a button: a page view that finds the
 * last sync older than ten minutes claims the next one and runs it after the response has gone.
 *
 * The claim is a conditional update of `gallery_synced_at`, so of many visitors arriving together
 * exactly one syncs. A pass that runs out of time clears the stamp again, so the next view carries on.
 */
export async function syncIfStale(tournament: { id: string; gallery_folder_id: string | null; gallery_synced_at: string | null }): Promise<void> {
  if (!tournament.gallery_folder_id) return;
  if (tournament.gallery_synced_at && Date.now() - Date.parse(tournament.gallery_synced_at) < STALE_MS) return;
  const sb = createServiceSupabase();
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const claim = await sb.from('tournaments').update({ gallery_synced_at: new Date().toISOString() })
    .eq('id', tournament.id).eq('gallery_folder_id', tournament.gallery_folder_id)
    .or(`gallery_synced_at.is.null,gallery_synced_at.lt.${cutoff}`).select('id');
  if (claim.error || !claim.data?.length) return;
  const res = await syncGallery(sb, tournament.id, tournament.gallery_folder_id, 40_000);
  if (!res.ok || res.remaining > 0) await sb.from('tournaments').update({ gallery_synced_at: res.ok ? null : new Date().toISOString() }).eq('id', tournament.id);
}

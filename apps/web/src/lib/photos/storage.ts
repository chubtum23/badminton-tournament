import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkStoredBytes, photoPath } from './rules';

const BUCKET = 'player-photos';

/**
 * Uploads one already-resized JPEG and returns its path, or null if it could not be stored.
 *
 * Null rather than a throw, because a photo is optional and losing a whole sign-up to a storage
 * timeout would be the worse failure. The caller carries on without that photo.
 */
export async function uploadPhoto(sb: SupabaseClient, tournamentId: string, file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = checkStoredBytes(bytes);
  if (problem) { console.warn('photo rejected', { tournamentId, problem }); return null; }
  const path = photoPath(tournamentId);
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (up.error) { console.error('photo upload failed', { tournamentId, message: up.error.message }); return null; }
  return path;
}

/** Best-effort: an unreferenced object is harmless, where a failed row update would not be. */
export async function deletePhotos(sb: SupabaseClient, paths: readonly string[]): Promise<void> {
  const targets = paths.filter(Boolean);
  if (targets.length === 0) return;
  const del = await sb.storage.from(BUCKET).remove([...targets]);
  if (del.error) console.warn('photo delete failed', { message: del.error.message });
}

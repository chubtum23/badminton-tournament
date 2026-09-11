import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const TTL_MS = 20_000;
const WAIT_MS = 8_000;
const POLL_MS = 150;

/** Tournaments whose lock the current request already holds, so a nested action does not wait on itself. */
const held = new AsyncLocalStorage<ReadonlySet<string>>();

export const BUSY_MESSAGE = 'Someone else is saving a result right now. Try again in a moment.';

/**
 * Runs `fn` while holding the tournament's result lock (see the result_lock migration).
 *
 * Everything a result depends on has to be read inside `fn`, not before: the point is that no other
 * result lands between the read and the writes planned from it. Nested calls for the same tournament
 * (withdrawTeam forfeiting through awardMatch) run straight through. If the lock stays taken for
 * longer than a few seconds, or cannot be asked for at all, `onBusy` answers instead.
 */
export async function withResultLock<T>(
  sb: SupabaseClient, tournamentId: string, fn: () => Promise<T>, onBusy: (message: string) => T,
): Promise<T> {
  const mine = held.getStore();
  if (mine?.has(tournamentId)) return fn();

  const holder = randomUUID();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const got = await sb.rpc('try_result_lock', { p_tournament: tournamentId, p_holder: holder, p_ttl_ms: TTL_MS });
    if (got.error) {
      console.error('result lock failed', { tournamentId, message: got.error.message });
      return onBusy('Could not save right now; try again');
    }
    if (got.data === true) break;
    if (Date.now() > deadline) return onBusy(BUSY_MESSAGE);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  try {
    return await held.run(new Set([...(mine ?? []), tournamentId]), fn);
  } finally {
    // Best effort: an unreleased lease simply expires.
    const rel = await sb.rpc('release_result_lock', { p_tournament: tournamentId, p_holder: holder });
    if (rel.error) console.warn('result lock release failed', { tournamentId, message: rel.error.message });
  }
}

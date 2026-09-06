import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Bypasses RLS. Only for code paths that have already authorised the caller themselves. */
export function createServiceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

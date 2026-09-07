'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/browser';

const pill = (status: 'connecting' | 'live' | 'reconnecting') => (
  <span data-testid="realtime-status" className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${status === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
    {status}
  </span>
);

function Refresher({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  // Compared as a string: the object identity is not guaranteed stable across re-renders, and an
  // effect that re-ran on every render would clear the debounce timer before it could ever fire.
  const search = useSearchParams().toString();
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A navigation already delivered fresh server output, so a refresh queued before it is at best
  // redundant and at worst races the new render (it used to blank the ?msg= banner of the page the
  // user had just been redirected to).
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, [pathname, search]);

  useEffect(() => {
    const sb = createBrowserSupabase();
    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 750);
    };
    const channel = sb
      .channel(`t:${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `tournament_id=eq.${tournamentId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'score_submissions' }, bump)
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') { setStatus('live'); bump(); }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setStatus('reconnecting');
      });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      sb.removeChannel(channel);
    };
  }, [tournamentId, router]);

  return pill(status);
}

export function RealtimeRefresh({ tournamentId }: { tournamentId: string }) {
  // useSearchParams needs a boundary if a page rendering this ever stops being dynamic.
  return <Suspense fallback={pill('connecting')}><Refresher tournamentId={tournamentId} /></Suspense>;
}

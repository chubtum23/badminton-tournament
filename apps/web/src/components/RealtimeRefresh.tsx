'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@/lib/supabase/browser';

export function RealtimeRefresh({ tournamentId }: { tournamentId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sb = createBrowserSupabase();
    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
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

  return (
    <span data-testid="realtime-status" className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${status === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
      {status === 'live' ? 'live' : status === 'connecting' ? 'connecting' : 'reconnecting'}
    </span>
  );
}

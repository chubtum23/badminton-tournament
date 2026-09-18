'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { liveKey, rowToLive, type LiveRow } from '@/lib/results/liveSheet';
import type { LiveGameRow } from '@/lib/db/types';

type LiveMap = ReadonlyMap<string, LiveRow>;

const Ctx = createContext<LiveMap>(new Map());

const toMap = (rows: readonly LiveGameRow[]): Map<string, LiveRow> => {
  const m = new Map<string, LiveRow>();
  for (const r of rows) {
    const live = rowToLive(r);
    if (live) m.set(liveKey(r.match_id, r.game_no), live);
  }
  return m;
};

/**
 * Every score sheet being kept in this tournament right now, kept current over realtime.
 *
 * This is separate from <RealtimeRefresh />, which re-renders the page from the server: a rally is
 * a few characters and arrives several times a minute per court, so rather than refetch every page
 * on each one, the sheets are held here on the client and the components showing them re-render.
 */
export function LiveGamesProvider({ tournamentId, initial, children }: {
  tournamentId: string;
  /** The sheets as the server rendered the page, so the first paint already shows them. */
  initial: readonly LiveGameRow[];
  children: React.ReactNode;
}) {
  const [games, setGames] = useState<Map<string, LiveRow>>(() => toMap(initial));

  useEffect(() => {
    const sb = createBrowserSupabase();
    let alive = true;
    const put = (r: LiveGameRow) => {
      const live = rowToLive(r);
      if (!live) return;
      const key = liveKey(r.match_id, r.game_no);
      // Events can arrive out of order across a reconnect; never step a sheet backwards.
      setGames((m) => ((m.get(key)?.rev ?? 0) > live.rev ? m : new Map(m).set(key, live)));
    };
    const drop = (r: Partial<LiveGameRow>) => {
      if (!r.match_id || r.game_no === undefined) return;
      const key = liveKey(r.match_id, r.game_no);
      setGames((m) => {
        if (!m.has(key)) return m;
        const next = new Map(m);
        next.delete(key);
        return next;
      });
    };
    // Anything missed while disconnected is picked up by reloading the lot on every (re)subscribe.
    const reload = async () => {
      const res = await sb.from('live_games').select('match_id, game_no, server, receiver, rallies, rev').eq('tournament_id', tournamentId);
      if (alive && !res.error) setGames(toMap((res.data ?? []) as LiveGameRow[]));
    };
    const channel = sb
      .channel(`live:${tournamentId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_games', filter: `tournament_id=eq.${tournamentId}` }, (p) => put(p.new as LiveGameRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_games', filter: `tournament_id=eq.${tournamentId}` }, (p) => put(p.new as LiveGameRow))
      // A delete carries only the key and cannot be filtered; a key from another tournament is
      // simply not in the map.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'live_games' }, (p) => drop(p.old as Partial<LiveGameRow>))
      .subscribe((s) => { if (s === 'SUBSCRIBED') void reload(); });
    return () => {
      alive = false;
      sb.removeChannel(channel);
    };
  }, [tournamentId]);

  return <Ctx.Provider value={games}>{children}</Ctx.Provider>;
}

/** The shared sheet of one game, or null when nobody is keeping one. */
export function useLiveGame(matchId: string, gameNo: number): LiveRow | null {
  return useContext(Ctx).get(liveKey(matchId, gameNo)) ?? null;
}

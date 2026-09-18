'use client';
import { useEffect, useReducer } from 'react';
import type { Settings } from '@tournament/core';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { validStart } from '@/lib/results/scoresheet';
import { decodeRallies, encodeRallies, initialSync, parsePush, syncReducer, type Stored } from '@/lib/results/liveSheet';
import { useLiveGame } from './LiveGames';
import { ScoreSheet } from './ScoreSheet';

/** Where this phone keeps its copy of a sheet, so a refresh or a dropped signal loses nothing. */
export const sheetStorageKey = (matchId: string, gameNo: number) => `scoresheet:${matchId}:${gameNo}`;

/** How long to wait before trying again after a send fails. */
const RETRY_MS = 2000;

function loadStored(key: string): Stored | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored> & { rallies?: unknown };
    const rallies = Array.isArray(v.rallies) ? decodeRallies(v.rallies.join('')) : null;
    if (!v.start || !validStart(v.start) || !rallies) return null;
    // A copy from before sheets were shared never reached the server.
    return { start: v.start, rallies, rev: typeof v.rev === 'number' ? v.rev : 0, dirty: typeof v.dirty === 'boolean' ? v.dirty : true };
  } catch { return null; }
}

/**
 * The scorer's score sheet, shared live.
 *
 * Every tap is kept on this phone and sent to the shared sheet at once; every other screen follows
 * it, and any other organiser who opens the same game's sheet picks it up where it stands and can
 * carry on. Only one send is in flight at a time — taps made meanwhile go with the next one.
 */
export function SharedScoreSheet({ matchId, gameNo, settings, teamA, teamB, names, onScore }: {
  matchId: string;
  gameNo: number;
  settings: Settings;
  teamA: string;
  teamB: string;
  names: readonly [string, string, string, string];
  onScore: (a: number, b: number) => void;
}) {
  const key = sheetStorageKey(matchId, gameNo);
  const live = useLiveGame(matchId, gameNo);
  // This only mounts in the browser, once the sheet is opened, so storage can be read up front.
  const [state, dispatch] = useReducer(syncReducer, null, () => initialSync(loadStored(key), live));

  // Keep this phone's copy current.
  useEffect(() => {
    try {
      if (state.closed || (state.sheet.rallies.length === 0 && !state.dirty)) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ ...state.sheet, rev: state.rev, dirty: state.dirty }));
    } catch { /* storage blocked */ }
  }, [key, state.sheet, state.rev, state.dirty, state.closed]);

  // Follow taps made on another device.
  useEffect(() => { dispatch({ type: 'remote', row: live }); }, [live]);

  // Send whatever the shared sheet has not got yet.
  const { dirty, sending, offline, closed, rev, sheet } = state;
  useEffect(() => {
    if (!dirty || sending || closed) return;
    const send = async () => {
      dispatch({ type: 'send', sheet });
      try {
        const res = await createBrowserSupabase().rpc('push_live_game', {
          p_match: matchId, p_game: gameNo, p_server: sheet.start.server, p_receiver: sheet.start.receiver,
          p_rallies: encodeRallies(sheet.rallies), p_rev: rev,
        });
        const result = res.error ? null : parsePush(res.data);
        dispatch(result ? { type: 'pushed', result } : { type: 'failed' });
      } catch {
        dispatch({ type: 'failed' });
      }
    };
    if (!offline) { void send(); return; }
    const timer = setTimeout(() => void send(), RETRY_MS);
    return () => clearTimeout(timer);
  }, [dirty, sending, offline, closed, rev, sheet, matchId, gameNo]);

  const sync = closed ? null : (
    <p data-testid="score-sheet-sync" className="flex items-center gap-2 text-xs font-bold uppercase tracking-label text-muted" aria-live="polite">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${offline ? 'bg-red-500' : 'bg-orange'}`} />
      {offline
        ? 'No signal — taps are kept on this phone and sent when it is back'
        : state.takenOver
          ? 'Another device scored that rally first — the sheet now shows theirs'
          : 'Live — everyone can follow this sheet'}
    </p>
  );

  return (
    <ScoreSheet
      settings={settings} teamA={teamA} teamB={teamB} names={names}
      start={state.sheet.start} rallies={state.sheet.rallies}
      onChange={(next) => dispatch({ type: 'edit', sheet: next })}
      onScore={onScore}
      sync={sync}
    />
  );
}

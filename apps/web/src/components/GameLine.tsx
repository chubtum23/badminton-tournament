'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Match, Settings } from '@tournament/core';
import type { GameRow, TeamRow, TournamentRow } from '@/lib/db/types';
import { gameLabel } from '@/lib/db/mappers';
import type { ActionResult } from '@/actions/errors';
import { clearGameScore, pauseGame, resumeGame, saveGameScore, startGame, takeGameOffCourt } from '@/actions/games';
import { CourtClock } from './CourtClock';
import { GameScoreForm } from './GameScoreForm';
import { SubmitButton } from './SubmitButton';

/**
 * One game of a meeting: its label and, once it has been played, its score — otherwise the court
 * controls and the clock. A court now holds a single game rather than a whole meeting, so this is
 * the row every screen schedules and scores against.
 *
 * `admin` false hides every control, which is what the public pages want; the same component then
 * renders the read-only "Court 2 · 09:41" line.
 */
export function GameLine({ tournament, match, slot, settings, teams, admin, showTeams = false }: {
  tournament: TournamentRow;
  match: Match;
  slot: GameRow;
  settings: Settings;
  teams: readonly TeamRow[];
  /** Render the organiser's controls. False on every public page. */
  admin: boolean;
  /** Also print the meeting's two team names, for the Now playing box. */
  showTeams?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const label = gameLabel(tournament, slot.game_no);
  const nameOf = (id: string | null) => (id ? teams.find((x) => x.id === id)?.name ?? '?' : 'TBD');
  const a = nameOf(match.teamAId), b = nameOf(match.teamBId);
  const scored = slot.score_a !== null && slot.score_b !== null;
  const running = slot.started_at !== null && !scored;

  /** Runs one of the court actions inside the form's own pending state, then refreshes. */
  const run = async (fn: () => Promise<ActionResult>) => {
    const r = await fn();
    if (!r.ok) { setError(r.message ?? r.error); return; }
    setError(null);
    router.refresh();
  };

  return (
    <div className="border-t py-1 text-sm first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        {showTeams && <span className="truncate">{a} v {b}</span>}
        {scored && (
          <>
            <span className="font-mono">{slot.score_a}-{slot.score_b}</span>
            {slot.time_expired && <span className="rounded bg-slate-200 px-1 text-[10px] uppercase tracking-wide text-slate-700">time</span>}
          </>
        )}
        {running && (
          <>
            {slot.court !== null && <span className="text-xs text-emerald-700">Court {slot.court}</span>}
            {settings.timeCapMinutes !== null && (
              <CourtClock startedAt={slot.started_at!} capMinutes={settings.timeCapMinutes} pausedAt={slot.paused_at} pausedMs={slot.paused_ms} />
            )}
          </>
        )}

        {admin && scored && (
          <>
            <button type="button" onClick={() => setChanging((v) => !v)} className="rounded border px-2 py-0.5 text-xs">Change</button>
            <form action={() => run(() => clearGameScore(tournament.slug, match.id, slot.game_no))}>
              <SubmitButton
                confirmMessage={`Clear the ${label} score? Any later match that depended on this meeting is reset.`}
                className="rounded border px-2 py-0.5 text-xs"
              >Clear</SubmitButton>
            </form>
          </>
        )}
        {admin && running && (
          <>
            {settings.timeCapMinutes !== null && (
              <form action={() => run(() => (slot.paused_at ? resumeGame(tournament.slug, match.id, slot.game_no) : pauseGame(tournament.slug, match.id, slot.game_no)))}>
                <SubmitButton className={`rounded border px-2 py-0.5 text-xs ${slot.paused_at ? 'border-amber-500 text-amber-800' : ''}`}>
                  {slot.paused_at ? 'Resume' : 'Pause'}
                </SubmitButton>
              </form>
            )}
            <form action={() => run(() => takeGameOffCourt(tournament.slug, match.id, slot.game_no))}>
              <SubmitButton className="rounded border px-2 py-0.5 text-xs">Take off court</SubmitButton>
            </form>
          </>
        )}
        {admin && !scored && !running && (
          <form
            action={(fd) => {
              const raw = String(fd.get('court') ?? '');
              return run(() => startGame(tournament.slug, match.id, slot.game_no, raw === '' ? null : Number(raw)));
            }}
            className="flex items-center gap-1 text-xs"
          >
            <label className="sr-only" htmlFor={`court-${match.id}-${slot.game_no}`}>Court for {label}</label>
            <select id={`court-${match.id}-${slot.game_no}`} name="court" defaultValue="" className="rounded border p-1">
              <option value="">first free</option>
              {Array.from({ length: tournament.court_count }, (_, i) => i + 1).map((c) => <option key={c} value={c}>Court {c}</option>)}
            </select>
            <SubmitButton className="rounded border px-2 py-0.5">Start now</SubmitButton>
          </form>
        )}
      </div>
      {/* Every unscored game takes a score, started or not: a game played on a court the organiser
          never assigned still has to be recorded. A scored game only opens on "Change". */}
      {admin && (!scored || changing) && (
        <div className="mt-1">
          <GameScoreForm
            matchId={match.id} gameNo={slot.game_no} settings={settings} label={label} teamA={a} teamB={b}
            existing={scored ? { scoreA: slot.score_a!, scoreB: slot.score_b!, timeExpired: slot.time_expired } : undefined}
            action={saveGameScore.bind(null, tournament.slug, match.id, slot.game_no)}
            confirmMessage={match.status === 'done' ? 'This meeting already has a result. Changing this score may reset every later match that depended on it. Continue?' : undefined}
          />
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

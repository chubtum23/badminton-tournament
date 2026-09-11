'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Match, Settings } from '@tournament/core';
import type { GameRow, RosterPlayerRow, TeamRow, TournamentRow } from '@/lib/db/types';
import { pairingGameNo, stageGameLabel } from '@/lib/db/mappers';
import { ratingSlots } from '@/lib/results/ratings';
import { pairNames } from '@/lib/teams/roster';
import type { ActionResult } from '@/actions/errors';
import { clearGameScore, pauseGame, resumeGame, saveGameScore, startGame, takeGameOffCourt } from '@/actions/games';
import { CourtClock } from './CourtClock';
import { GameScoreForm } from './GameScoreForm';
import { SubmitButton } from './SubmitButton';
import { ui } from './ui';

/** A team as the schedule screens have it: the roster is present on the pages that loaded it. */
export type TeamMaybeRoster = TeamRow & { players?: RosterPlayerRow[] };

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden viewBox="0 0 16 16" width="16" height="16"
      className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
    </svg>
  );
}

/**
 * One game of a meeting.
 *
 * Collapsed, this is a single row: the game's name, the two pairs playing it, and either the score
 * (a played game inverts to navy and prints it large) or the one button that matters — Start. That
 * keeps a meeting card to three quiet rows instead of three stacked forms, which is what an
 * organiser scanning six cards on a bench actually needs.
 *
 * Everything else — picking a specific court, entering or correcting a score, the clock controls —
 * lives behind the chevron, because those are things you do to one game at a time.
 *
 * `collapsible` false renders it all inline with no chevron. The Now playing box passes that: it is
 * already filtered to the games on court, so there is nothing to hide, and it is where the
 * organiser reaches for Pause and the score as the game finishes.
 *
 * `admin` false hides every control, which is what the public pages want.
 */
export function GameLine({ tournament, match, slot, settings, teams, admin, showTeams = false, collapsible = false }: {
  tournament: TournamentRow;
  match: Match;
  slot: GameRow;
  settings: Settings;
  teams: readonly TeamMaybeRoster[];
  /** Render the organiser's controls. False on every public page. */
  admin: boolean;
  /** Also print the meeting's two team names, for the Now playing box. */
  showTeams?: boolean;
  /** Collapse the controls behind a chevron. True on the meeting cards. */
  collapsible?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [open, setOpen] = useState(false);
  const label = stageGameLabel(tournament, match.stage, slot.game_no);
  // Whose pair is on court: a playoff's only game is the men's doubles.
  const pairingNo = pairingGameNo(match.stage, slot.game_no);
  const nameOf = (id: string | null) => (id ? teams.find((x) => x.id === id)?.name ?? '?' : 'TBD');
  const a = nameOf(match.teamAId), b = nameOf(match.teamBId);
  // The two players of that team who play this game number, once the roster is loaded and complete.
  const pairOf = (id: string | null) => {
    const team = id ? teams.find((x) => x.id === id) : undefined;
    return team?.players ? pairNames({ players: team.players }, pairingNo) : null;
  };
  const pairA = pairOf(match.teamAId), pairB = pairOf(match.teamBId);
  const scored = slot.score_a !== null && slot.score_b !== null;
  const running = slot.started_at !== null && !scored;
  // Uncollapsible lines (the Now playing box) are simply always open.
  const expanded = !collapsible || open;

  /** Runs one of the court actions inside the form's own pending state, then refreshes. */
  const run = async (fn: () => Promise<ActionResult>) => {
    const r = await fn();
    if (!r.ok) { setError(r.message ?? r.error); return; }
    setError(null);
    router.refresh();
  };

  /** Start on whichever court is free. Picking a specific one is behind the chevron. */
  const quickStart = (
    <form action={() => run(() => startGame(tournament.slug, match.id, slot.game_no, null))}>
      <SubmitButton className="bg-orange px-6 py-2.5 text-sm font-bold uppercase tracking-label text-ink hover:bg-orange-bright">Start</SubmitButton>
    </form>
  );

  const summary = (
    <div className={`flex flex-wrap items-center justify-between gap-4 px-5 py-4 ${scored ? 'bg-navy text-bone' : ''}`}>
      <span className="min-w-0">
        <span className={`block text-base font-bold uppercase tracking-wide ${scored ? 'text-orange-bright' : ''}`}>
          {label}{scored ? ' — Final' : ''}{scored && slot.time_expired ? ' · time' : ''}
        </span>
        {(pairA || pairB) && (
          <span data-testid="pair-names" className={`block text-sm ${scored ? 'text-onnavy-soft' : 'text-muted'}`}>
            {pairA ?? '—'} · {pairB ?? '—'}
          </span>
        )}
        {showTeams && <span className="block font-display text-sm font-extrabold uppercase">{a} v {b}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {scored && <span className="font-display text-3xl font-black tabular-nums">{slot.score_a}–{slot.score_b}</span>}
        {running && (
          <>
            {slot.court !== null && <span className={ui.pillLive}>Court {slot.court}</span>}
            {settings.timeCapMinutes !== null && (
              <CourtClock startedAt={slot.started_at!} capMinutes={settings.timeCapMinutes} pausedAt={slot.paused_at} pausedMs={slot.paused_ms} />
            )}
          </>
        )}
        {admin && !scored && !running && collapsible && quickStart}
        {admin && collapsible && (
          <button
            type="button"
            data-testid="game-toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${label} details`}
            onClick={() => setOpen((v) => !v)}
            className={`p-1.5 ${scored ? 'text-orange-bright hover:text-bone' : 'text-muted hover:text-navy'}`}
          >
            <Chevron open={open} />
          </button>
        )}
      </span>
    </div>
  );

  return (
    <div
      data-testid="game-row"
      data-scored={scored ? 'true' : 'false'}
      className={collapsible ? (scored ? 'border-hair border-navy' : 'border-hair border-line') : 'border-t-hair border-line first:border-t-0'}
    >
      {summary}

      {admin && expanded && (
        <div className={`space-y-3 px-5 pb-4 ${collapsible ? 'border-t-hair border-line pt-4' : 'pb-3'}`}>
          <div className="flex flex-wrap items-center gap-2.5">
            {scored && (
              <>
                <button type="button" onClick={() => setChanging((v) => !v)} className={ui.tiny}>Change</button>
                <form action={() => run(() => clearGameScore(tournament.slug, match.id, slot.game_no))}>
                  <SubmitButton
                    confirmMessage={match.status === 'done'
                      ? `Clear the ${label} score? This meeting is decided, so its result is undone too, and any later match it sent a team to goes back to waiting.`
                      : `Clear the ${label} score?`}
                    className={ui.tiny}
                  >Clear</SubmitButton>
                </form>
                {slot.court !== null && <span className={`${ui.eyebrow} text-muted`}>Played on court {slot.court}</span>}
              </>
            )}
            {running && (
              <>
                {settings.timeCapMinutes !== null && (
                  <form action={() => run(() => (slot.paused_at ? resumeGame(tournament.slug, match.id, slot.game_no) : pauseGame(tournament.slug, match.id, slot.game_no)))}>
                    <SubmitButton className={`${ui.tiny} ${slot.paused_at ? 'border-orange text-orange-ink' : ''}`}>
                      {slot.paused_at ? 'Resume' : 'Pause'}
                    </SubmitButton>
                  </form>
                )}
                <form action={() => run(() => takeGameOffCourt(tournament.slug, match.id, slot.game_no))}>
                  <SubmitButton
                    confirmMessage={`Take ${label} off court? Its clock is thrown away and starts from the beginning next time.`}
                    className={ui.tiny}
                  >Take off court</SubmitButton>
                </form>
              </>
            )}
            {!scored && !running && (
              <form
                action={(fd) => {
                  const raw = String(fd.get('court') ?? '');
                  return run(() => startGame(tournament.slug, match.id, slot.game_no, raw === '' ? null : Number(raw)));
                }}
                className="flex items-center gap-2"
              >
                <label className="sr-only" htmlFor={`court-${match.id}-${slot.game_no}`}>Court for {label}</label>
                <select id={`court-${match.id}-${slot.game_no}`} name="court" defaultValue="" className={ui.fieldSm}>
                  <option value="">first free</option>
                  {Array.from({ length: tournament.court_count }, (_, i) => i + 1).map((c) => <option key={c} value={c}>Court {c}</option>)}
                </select>
                <SubmitButton className="bg-orange px-5 py-2 text-sm font-bold uppercase tracking-label text-ink hover:bg-orange-bright">Start now</SubmitButton>
              </form>
            )}
          </div>

          {/* Every unscored game takes a score, started or not: a game played on a court the
              organiser never assigned still has to be recorded. A scored one opens on "Change". */}
          {(!scored || changing) && (
            <GameScoreForm
              matchId={match.id} gameNo={slot.game_no} settings={settings} label={label} teamA={a} teamB={b}
              existing={scored ? { scoreA: slot.score_a!, scoreB: slot.score_b!, timeExpired: slot.time_expired } : undefined}
              action={saveGameScore.bind(null, tournament.slug, match.id, slot.game_no)}
              slots={ratingSlots(teams.find((t) => t.id === match.teamAId), teams.find((t) => t.id === match.teamBId), pairingNo)}
              confirmMessage={match.status === 'done' ? 'This meeting already has a result. Changing this score may reset every later match that depended on it. Continue?' : undefined}
            />
          )}
          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}

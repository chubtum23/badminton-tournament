import type { Match, Settings } from '@tournament/core';
import type { TournamentRow } from '@/lib/db/types';
import type { ScheduledGame } from '@/lib/schedule/board';
import { GameLine, type TeamMaybeRoster } from './GameLine';
import { ui } from './ui';

/**
 * The games on court right now, at the top of the organiser's Matches screen and of the public
 * live page. A court holds one game, so this lists games rather than meetings: the meeting's two
 * teams, the game's label, its court and its clock.
 *
 * With nothing on court this collapses to a single status bar rather than an empty card. That is
 * the state the organiser sees between games, and it should read as an instruction ("put a game
 * on") rather than as an absence.
 */
export function NowPlaying({ tournament, games, teams, settings, admin = false }: {
  tournament: TournamentRow;
  games: readonly ScheduledGame[];
  teams: readonly TeamMaybeRoster[];
  /** The rules for one game's stage; a resolver because the board can mix stages. */
  settings: (match: Match) => Settings;
  /** Render the organiser's court, clock and score controls. */
  admin?: boolean;
}) {
  if (games.length === 0) {
    return (
      <section data-testid="now-playing" className={`${ui.card} flex flex-wrap items-center gap-4 px-7 py-5`}>
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange" />
        <h2 className="text-base font-bold uppercase tracking-label">Court is free</h2>
        <p className="text-base text-muted">{admin ? 'Hit “Start now” on any game below to put it on court.' : 'Nothing is on court at the moment.'}</p>
      </section>
    );
  }
  return (
    <section data-testid="now-playing" className={ui.card}>
      <div className={`${ui.head} bg-navy text-bone`}>
        <h2 className="flex items-center gap-3.5 text-[15px] font-bold uppercase tracking-label">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange" />
          On court now
        </h2>
        <span className="text-xs font-bold uppercase tracking-label text-orange">{games.length} game{games.length === 1 ? '' : 's'}</span>
      </div>
      {/* Each game in its own box with a gap between, so four courts at once never read as one list. */}
      <div className="flex flex-col gap-5 px-3 py-4 sm:px-7 sm:py-6">
        {games.map((g) => (
          <div key={`${g.slot.match_id}:${g.slot.game_no}`} className="border-hair border-line-strong">
            <GameLine
              tournament={tournament} match={g.match} slot={g.slot} settings={settings(g.match)}
              teams={teams} admin={admin} showTeams
            />
          </div>
        ))}
      </div>
    </section>
  );
}

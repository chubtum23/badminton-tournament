import type { Match, Settings } from '@tournament/core';
import type { TournamentRow } from '@/lib/db/types';
import type { ScheduledGame } from '@/lib/schedule/board';
import { GameLine, type TeamMaybeRoster } from './GameLine';

/**
 * The games on court right now, at the top of the organiser's Matches screen and of the public
 * live page. A court holds one game, so this lists games rather than meetings: the meeting's two
 * teams, the game's label, its court and its clock.
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
  return (
    <section data-testid="now-playing" className="rounded border border-emerald-500 bg-white p-3">
      <h2 className="mb-1 font-semibold">Now playing ({games.length})</h2>
      {games.length === 0 ? (
        <p className="text-sm text-slate-500">No game is on court.</p>
      ) : (
        <div>
          {games.map((g) => (
            <GameLine
              key={`${g.slot.match_id}:${g.slot.game_no}`}
              tournament={tournament} match={g.match} slot={g.slot} settings={settings(g.match)}
              teams={teams} admin={admin} showTeams
            />
          ))}
        </div>
      )}
    </section>
  );
}

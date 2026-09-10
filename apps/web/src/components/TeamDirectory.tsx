import type { PlayerRatingRow, RosterRole, TeamRatingRow } from '@tournament/core';
import type { RosterPlayerRow, TeamRow } from '@/lib/db/types';
import { poolTone, ui } from './ui';

/** The roster in playing order, named the way the sign-up form named them. */
const ROLE_LABEL: Record<RosterRole, string> = {
  mixed1: 'Mixed #1', mixed2: 'Mixed #2', woman: 'Woman',
};
const ROLE_ORDER: readonly RosterRole[] = ['mixed1', 'mixed2', 'woman'];

/** A rating always reads with its decimal, so 7 shows as 7.0 rather than sitting a digit short. */
const show = (n: number | null) => (n === null ? '—' : n.toFixed(1));

export interface DirectoryTeam extends TeamRow {
  players: RosterPlayerRow[];
}

/** One pool's worth of teams, in the order the pool page lists them. */
export interface DirectoryGroup {
  key: string;
  name: string;
  /** Index into the pool colours; null for the ungrouped section, which stays neutral. */
  tone: number | null;
  teams: DirectoryTeam[];
}

function Rating({ value, caption }: { value: number | null; caption: string }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5">
      <span className="font-display text-lg font-black tabular-nums" data-testid="team-rating">{show(value)}</span>
      <span className="text-[11px] font-bold uppercase tracking-label text-muted">{caption}</span>
    </span>
  );
}

/**
 * Every team of the tournament, grouped by pool.
 *
 * A card is closed to its identity — colour, name, tagline and the team's power — because that is
 * what someone scanning for a team needs. Opening one is what shows the write-up they submitted at
 * sign-up and the three players behind that number, each with their own.
 *
 * "Power" rather than "average" or "rating": on a public page the number has to say what it means
 * at a glance, and what it means is how strong this team has looked. "Ranking" would be wrong —
 * it reads as a position in a table, and this is a level out of 10.
 *
 * A plain <details> rather than React state: nothing here needs to survive a click, and a server
 * component means the whole directory ships as HTML with no hydration cost.
 */
export function TeamDirectory({ groups, teamRows, playerRows }: {
  groups: readonly DirectoryGroup[];
  teamRows: readonly TeamRatingRow[];
  playerRows: readonly PlayerRatingRow[];
}) {
  const teamRating = (id: string) => teamRows.find((r) => r.teamId === id) ?? null;
  const playerRating = (id: string) => playerRows.find((r) => r.playerId === id) ?? null;

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.key} data-testid="team-group">
          <h2 className={`${ui.h2} mb-4`}>{group.name}</h2>
          {/* items-start, because a grid row stretches its items to the tallest one by default:
              opening one card would otherwise grow the empty box of the card beside it. */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {group.teams.map((team) => {
              const rating = teamRating(team.id);
              // Roles are fixed, so the roster always reads Mixed #1, Mixed #2, Woman rather than
              // whatever order the rows came back in. Anyone unrolled (a legacy row) follows.
              const roster = [
                ...ROLE_ORDER.map((role) => team.players.find((p) => p.role === role)).filter((p): p is RosterPlayerRow => p !== undefined),
                ...team.players.filter((p) => p.role === null),
              ];
              return (
                <details key={team.id} data-testid="team-card" data-team={team.id} className={ui.card}>
                  <summary className={`${ui.head} ${group.tone === null ? '' : poolTone(group.tone).head} disclosure disclosure-lg`}>
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: team.colour }} />
                      <span className="min-w-0">
                        <span className={`block truncate font-display text-lg font-extrabold uppercase tracking-tight ${team.withdrawn ? 'text-muted-soft line-through' : ''}`}>{team.name}</span>
                        {team.tagline && <span className="block truncate text-xs font-normal normal-case tracking-normal text-muted">{team.tagline}</span>}
                      </span>
                    </span>
                    <Rating value={rating?.average ?? null} caption="power" />
                  </summary>
                  <div className="space-y-5 px-7 py-6">
                    {team.withdrawn && <p className={ui.alarm}>This team has withdrawn.</p>}
                    {team.description
                      ? <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{team.description}</p>
                      : <p className="text-sm text-muted">This team has not written anything about themselves.</p>}
                    <div>
                      {/* The column is named once at the top rather than on every row: four
                          repetitions of the word beside four numbers reads as noise. */}
                      <h3 className={`${ui.eyebrow} mb-2 flex items-center justify-between text-muted`}>
                        <span>Players</span><span>Power</span>
                      </h3>
                      <ul>
                        {roster.map((p) => {
                          const pr = playerRating(p.id);
                          return (
                            <li key={p.id} data-testid="team-player" className="flex items-center justify-between gap-3 border-t-hair border-line-soft py-2.5 first:border-t-0">
                              <span className="min-w-0">
                                <span className="block truncate font-bold">{p.name}</span>
                                <span className="block text-[11px] font-bold uppercase tracking-label text-muted">
                                  {p.role ? ROLE_LABEL[p.role] : 'No role set'}
                                  {pr && pr.gamesRated > 0 && <> · {pr.gamesRated} game{pr.gamesRated === 1 ? '' : 's'} rated</>}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-baseline gap-2">
                                {pr?.rank != null && <span className="text-[11px] font-bold uppercase tracking-label text-muted">#{pr.rank}</span>}
                                <span className="font-display text-base font-black tabular-nums" data-testid="player-rating">{show(pr?.average ?? null)}</span>
                              </span>
                            </li>
                          );
                        })}
                        {roster.length === 0 && <li className="py-2.5 text-sm text-muted">No players yet.</li>}
                      </ul>
                    </div>
                  </div>
                </details>
              );
            })}
            {group.teams.length === 0 && <p className={ui.empty}>No teams in this pool.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}

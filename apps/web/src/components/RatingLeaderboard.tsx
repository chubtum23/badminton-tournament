'use client';
import { useState } from 'react';
import type { PlayerRatingRow, TeamRatingRow } from '@tournament/core';
import { ui } from './ui';

const th = 'pb-3 pt-1 text-xs font-bold uppercase tracking-label text-muted';
const num = 'px-1 text-center tabular-nums text-muted-strong';
/** An average is the point of the table, so it is set in the display face like a score. */
const score = 'px-1 text-right font-display text-lg font-black tabular-nums';

/** A rating always reads with its decimal, so 7 shows as 7.0 rather than sitting a digit short. */
const show = (n: number | null) => (n === null ? '—' : n.toFixed(1));

function Tab({ active, onClick, label, testId }: { active: boolean; onClick: () => void; label: string; testId: string }) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testId} aria-pressed={active}
      className={`px-6 py-3 text-sm font-bold uppercase tracking-label ${active ? 'bg-navy text-white' : 'border-hair border-navy text-navy hover:bg-line-soft'}`}
    >{label}</button>
  );
}

/**
 * Every player of the tournament by their average mark out of 10, with a team view that averages
 * each team's players. The two views are one component because they are one question asked two
 * ways, and the filter has to feel instant — a link per view would reload the page.
 */
export function RatingLeaderboard({ players, teams }: { players: readonly PlayerRatingRow[]; teams: readonly TeamRatingRow[] }) {
  const [view, setView] = useState<'players' | 'teams'>('players');
  const nobodyRated = players.every((p) => p.average === null);

  return (
    <section className={ui.card}>
      <div className={ui.head}>
        <h2 className={ui.eyebrow}>Form</h2>
        <div className="flex" data-testid="rating-filter">
          <Tab active={view === 'players'} onClick={() => setView('players')} label="Players" testId="rating-filter-players" />
          <Tab active={view === 'teams'} onClick={() => setView('teams')} label="Teams" testId="rating-filter-teams" />
        </div>
      </div>
      <div className={ui.body}>
        {nobodyRated && (
          <p className="mb-5 text-sm text-muted">
            Nobody has been rated yet. The organiser marks each player out of 10 as they score each game.
          </p>
        )}
        {view === 'players' ? (
          <table className="w-full text-base" data-testid="player-leaderboard">
            <thead>
              <tr className="border-b-hair border-line text-left">
                <th className={`${th} w-7`}>#</th>
                <th className={th}>Player</th>
                <th className={th}>Team</th>
                <th className={`${th} w-12 text-center`}>Gms</th>
                <th className={`${th} w-16 text-right`}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.playerId} data-testid="rating-row" data-player={p.playerId} className="border-b-hair border-line-soft">
                  <td className="py-4 font-display text-lg font-extrabold">{p.rank ?? '—'}</td>
                  <td className="py-4 font-bold">{p.name}</td>
                  <td className="py-4 text-sm text-muted">{p.teamName}</td>
                  <td className={num}>{p.gamesRated}</td>
                  <td className={score} data-testid="rating-average">{show(p.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-base" data-testid="team-leaderboard">
            <thead>
              <tr className="border-b-hair border-line text-left">
                <th className={`${th} w-7`}>#</th>
                <th className={th}>Team</th>
                <th className={`${th} w-16 text-center`}>Rated</th>
                <th className={`${th} w-16 text-right`}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.teamId} data-testid="rating-row" data-team={t.teamId} className="border-b-hair border-line-soft">
                  <td className="py-4 font-display text-lg font-extrabold">{t.rank ?? '—'}</td>
                  <td className="py-4 font-bold">{t.name}</td>
                  <td className={num}>{t.playersRated}</td>
                  <td className={score} data-testid="rating-average">{show(t.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-4 text-xs text-muted">
          An average of every mark out of 10 the organiser has given that player. A team scores the average of its players.
        </p>
      </div>
    </section>
  );
}

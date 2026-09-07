import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { awardMatch, confirmSubmission } from '@/actions/matches';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { gameSlotsByMatch, listGames, listMatches, listPools, listSubmissions, listTeams, latestByMatch } from '@/lib/db/queries';
import { rowToMatch, settingsFor } from '@/lib/db/mappers';
import { scheduleBoard } from '@/lib/schedule/board';
import { MatchCard, teamName } from '@/components/MatchCard';
import { GameLine } from '@/components/GameLine';
import { NowPlaying } from '@/components/NowPlaying';
import { SubmissionCompare } from '@/components/SubmissionCompare';
import { SubmitButton } from '@/components/SubmitButton';
import { FlashMessage } from '@/components/FlashMessage';
import { RecentOutcome } from '@/components/RecentOutcome';

export default async function MatchesAdminPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { slug } = await params;
  const { filter = 'open' } = await searchParams;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [pools, teams, matchRows, gameRows, subs] = await Promise.all([
    listPools(ctx.sb, t.id), listTeams(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id), listSubmissions(ctx.sb, t.id),
  ]);
  const matches = matchRows.map(rowToMatch);
  // Rules are per stage, so each meeting's games are rendered against their own settings.
  const settingsOf = (m: typeof matches[number]) => settingsFor(t, m.stage);
  // Every game row of a meeting, played or not: these are what go to court and take a score.
  const slots = gameSlotsByMatch(gameRows);
  const board = scheduleBoard({
    tournament: t, matches, slots: gameRows, poolOrder: pools.map((p) => p.id),
    stage: t.status === 'pools' ? 'pool' : 'knockout',
  });
  const latest = latestByMatch(subs);
  const shown = matches.filter((m) => filter === 'all' ? true : filter === 'done' ? m.status === 'done' : m.status !== 'done' && m.status !== 'pending');
  const attention = matches.filter((m) => m.status === 'submitted' || m.status === 'disputed');
  const poolName = (m: typeof matches[number]) => pools.find((p) => p.id === m.poolId)?.name ?? 'Pool';
  const label = (m: typeof matches[number]) => m.stage === 'pool' ? `${poolName(m)} · #${m.slot}`
    : m.stage === 'playoff' ? `${poolName(m)} · playoff`
    : `Round ${m.round} · #${m.slot}`;
  const here = `/admin/${slug}/matches?filter=${filter}`;

  async function confirm(formData: FormData) {
    'use server';
    redirectWithMsg(here, await confirmSubmission(slug, String(formData.get('matchId')), String(formData.get('submissionId'))), 'Result confirmed');
  }
  /** Hands the meeting to one side without a score (walkover, no-show, organiser's call). */
  async function award(formData: FormData) {
    'use server';
    redirectWithMsg(here, await awardMatch(slug, String(formData.get('matchId')), String(formData.get('winnerId'))), 'Match awarded');
  }

  return (
    <div className="space-y-4">
      <FlashMessage />
      <RecentOutcome />
      <NowPlaying tournament={t} games={board.nowPlaying} teams={teams} settings={settingsOf} admin />
      {attention.length > 0 && (
        <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
          <h2 className="font-semibold">Needs attention ({attention.length})</h2>
          {attention.map((m) => (
            <MatchCard key={m.id} match={m} teams={teams} games={[]} label={`${label(m)} · ${m.status}`}>
              <SubmissionCompare a={latest[m.id]?.a} b={latest[m.id]?.b} teamA={teamName(teams, m.teamAId)} teamB={teamName(teams, m.teamBId)}
                onConfirm={(id) => (
                  <form action={confirm}><input type="hidden" name="matchId" value={m.id} /><input type="hidden" name="submissionId" value={id} /><SubmitButton className="rounded bg-emerald-700 px-2 py-1 text-xs text-white">Confirm this</SubmitButton></form>
                )} />
              <p className="mt-2 text-xs text-slate-600">Or enter the games yourself below in the list.</p>
            </MatchCard>
          ))}
        </section>
      )}
      <nav className="flex gap-2 text-sm">
        {['open', 'done', 'all'].map((f) => <a key={f} href={`/admin/${slug}/matches?filter=${f}`} className={`rounded px-2 py-1 ${f === filter ? 'bg-slate-900 text-white' : 'border'}`}>{f}</a>)}
      </nav>
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((m) => (
          <MatchCard key={m.id} match={m} teams={teams} games={[]} label={label(m)}>
            {m.teamAId && m.teamBId && m.status !== 'pending' && (
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                {([['a', m.teamAId], ['b', m.teamBId]] as const).map(([side, id]) => (
                  <form key={side} action={award}>
                    <input type="hidden" name="matchId" value={m.id} />
                    <input type="hidden" name="winnerId" value={id!} />
                    <SubmitButton
                      confirmMessage={`Award this match to ${teamName(teams, id)} without a score? Any later match that depended on it is reset.`}
                      className="rounded border px-2 py-1"
                    >Award to {teamName(teams, id)}</SubmitButton>
                  </form>
                ))}
              </div>
            )}
            {m.teamAId && m.teamBId
              ? (slots[m.id] ?? []).map((s) => (
                <GameLine key={s.game_no} tournament={t} match={m} slot={s} settings={settingsOf(m)} teams={teams} admin={m.status !== 'pending'} />
              ))
              : <p className="text-xs text-slate-500">Waiting on both teams.</p>}
          </MatchCard>
        ))}
        {shown.length === 0 && <p className="text-sm text-slate-500">Nothing here.</p>}
      </div>
    </div>
  );
}

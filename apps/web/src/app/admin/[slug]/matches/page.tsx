import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { awardMatch, confirmSubmission } from '@/actions/matches';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { gameSlotsByMatch, listGames, listMatches, listPools, listSubmissions, listTeamsWithPlayers, latestByMatch } from '@/lib/db/queries';
import { rowToMatch, settingsFor } from '@/lib/db/mappers';
import { scheduleBoard } from '@/lib/schedule/board';
import { MatchCard, teamName } from '@/components/MatchCard';
import { GameLine } from '@/components/GameLine';
import { NowPlaying } from '@/components/NowPlaying';
import { SubmissionCompare } from '@/components/SubmissionCompare';
import { SubmitButton } from '@/components/SubmitButton';
import { FlashMessage } from '@/components/FlashMessage';
import { RecentOutcome } from '@/components/RecentOutcome';
import { ui } from '@/components/ui';

export default async function MatchesAdminPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ pool?: string }> }) {
  const { slug } = await params;
  const { pool: poolFilter = 'all' } = await searchParams;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [pools, teams, matchRows, gameRows, subs] = await Promise.all([
    listPools(ctx.sb, t.id), listTeamsWithPlayers(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id), listSubmissions(ctx.sb, t.id),
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
  // One tab per pool, plus All and Knockout: the organiser runs one pool at a time on the night.
  const inTab = (m: typeof matches[number]) =>
    poolFilter === 'all' ? true : poolFilter === 'knockout' ? m.stage === 'knockout' : m.poolId === poolFilter;
  const visible = matches.filter(inTab);
  const ready = visible.filter((m) => m.status !== 'done' && m.status !== 'pending');
  const waiting = visible.filter((m) => m.status === 'pending');
  const finished = visible.filter((m) => m.status === 'done');
  const attention = matches.filter((m) => m.status === 'submitted' || m.status === 'disputed');
  const poolName = (m: typeof matches[number]) => pools.find((p) => p.id === m.poolId)?.name ?? 'Pool';
  const label = (m: typeof matches[number]) => m.stage === 'pool' ? `${poolName(m)} · #${m.slot}`
    : m.stage === 'playoff' ? `${poolName(m)} · playoff`
    : `Round ${m.round} · #${m.slot}`;
  const here = `/admin/${slug}/matches?pool=${poolFilter}`;
  const tabsList = [['all', 'All'], ...pools.map((p) => [p.id, p.name] as const), ['knockout', 'Knockout']] as const;

  async function confirm(formData: FormData) {
    'use server';
    redirectWithMsg(here, await confirmSubmission(slug, String(formData.get('matchId')), String(formData.get('submissionId'))), 'Result confirmed');
  }
  /** Hands the meeting to one side without a score (walkover, no-show, organiser's call). */
  async function award(formData: FormData) {
    'use server';
    redirectWithMsg(here, await awardMatch(slug, String(formData.get('matchId')), String(formData.get('winnerId'))), 'Match awarded');
  }

  /** The playable card: the award buttons and one row per game. Finished meetings get the same one
      so a score entered by mistake can still be changed. */
  const card = (m: typeof matches[number]) => (
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
  );

  return (
    <div className="space-y-5">
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
      <nav aria-label="Filter by pool" className="flex flex-wrap gap-2">
        {tabsList.map(([key, name]) => (
          <a key={key} href={`/admin/${slug}/matches?pool=${key}`} aria-current={key === poolFilter ? 'page' : undefined} className={`rounded-lg px-4 py-2 text-base font-medium ${key === poolFilter ? 'bg-slate-900 text-white' : 'border bg-white'}`}>{name}</a>
        ))}
      </nav>
      <section>
        <h2 className={`${ui.h2} mb-2`}>Ready to play ({ready.length})</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {ready.map((m) => card(m))}
          {ready.length === 0 && <p className="text-sm text-slate-500">Nothing waiting.</p>}
        </div>
      </section>
      {waiting.length > 0 && (
        <section>
          <h2 className={`${ui.h2} mb-2`}>Waiting on an earlier result ({waiting.length})</h2>
          <div className="grid gap-3 lg:grid-cols-2">{waiting.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={[]} label={label(m)} />)}</div>
        </section>
      )}
      <details className="rounded-xl border bg-white p-4" open={finished.length > 0 && ready.length === 0}>
        <summary className="cursor-pointer text-lg font-semibold">Finished ({finished.length})</summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {finished.map((m) => card(m))}
        </div>
      </details>
    </div>
  );
}

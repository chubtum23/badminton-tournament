import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { assignCourt, awardMatch, startNow, enterResultForm, confirmSubmission, pauseMatch, resumeMatch } from '@/actions/matches';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listGames, listMatches, listPools, listSubmissions, listTeams, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { MatchCard, teamName } from '@/components/MatchCard';
import { ScoreForm } from '@/components/ScoreForm';
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
  // Rules are per stage, so each card gets its own settings; the score action needs the same
  // per-match game count, which it looks up in this (serialisable) map.
  const settingsOf = (m: typeof matches[number]) => settingsFor(t, m.stage);
  // `Match` carries no timestamps, so the court clock reads started_at and the pause fields
  // straight off the raw rows.
  const startedAtById: Record<string, string | null> = Object.fromEntries(matchRows.map((r) => [r.id, r.started_at]));
  const pauseById: Record<string, { at: string | null; ms: number }> = Object.fromEntries(matchRows.map((r) => [r.id, { at: r.paused_at, ms: r.paused_ms }]));
  const games = gamesByMatch(gameRows);
  const latest = latestByMatch(subs);
  const shown = matches.filter((m) => filter === 'all' ? true : filter === 'done' ? m.status === 'done' : m.status !== 'done' && m.status !== 'pending');
  const attention = matches.filter((m) => m.status === 'submitted' || m.status === 'disputed');
  const poolName = (m: typeof matches[number]) => pools.find((p) => p.id === m.poolId)?.name ?? 'Pool';
  const label = (m: typeof matches[number]) => m.stage === 'pool' ? `${poolName(m)} · #${m.slot}`
    : m.stage === 'playoff' ? `${poolName(m)} · playoff`
    : `Round ${m.round} · #${m.slot}`;
  const here = `/admin/${slug}/matches?filter=${filter}`;

  /** One handler for the three court buttons; `op` says which button was pressed. */
  async function court(formData: FormData) {
    'use server';
    const matchId = String(formData.get('matchId'));
    const raw = String(formData.get('court') ?? '');
    const op = String(formData.get('op') ?? 'start');
    const picked = raw === '' ? null : Number(raw);
    // redirectWithMsg never returns, but the explicit if/else keeps that from being load-bearing.
    if (op === 'off') {
      return redirectWithMsg(here, await assignCourt(slug, matchId, null), 'Taken off court');
    } else {
      return redirectWithMsg(here, await startNow(slug, matchId, picked), 'On court');
    }
  }
  /** Stops or restarts the countdown on a live match; `op` says which button was pressed. */
  async function clock(formData: FormData) {
    'use server';
    const matchId = String(formData.get('matchId'));
    if (String(formData.get('op')) === 'resume') {
      return redirectWithMsg(here, await resumeMatch(slug, matchId), 'Clock resumed');
    } else {
      return redirectWithMsg(here, await pauseMatch(slug, matchId), 'Clock paused');
    }
  }
  async function confirm(formData: FormData) {
    'use server';
    redirectWithMsg(here, await confirmSubmission(slug, String(formData.get('matchId')), String(formData.get('submissionId'))), 'Result confirmed');
  }
  /** Hands the match to one side without a score (walkover, no-show, organiser's call). */
  async function award(formData: FormData) {
    'use server';
    redirectWithMsg(here, await awardMatch(slug, String(formData.get('matchId')), String(formData.get('winnerId'))), 'Match awarded');
  }

  return (
    <div className="space-y-4">
      <FlashMessage />
      <RecentOutcome />
      {attention.length > 0 && (
        <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
          <h2 className="font-semibold">Needs attention ({attention.length})</h2>
          {attention.map((m) => (
            <MatchCard key={m.id} match={m} teams={teams} games={[]} label={`${label(m)} · ${m.status}`}>
              <SubmissionCompare a={latest[m.id]?.a} b={latest[m.id]?.b} teamA={teamName(teams, m.teamAId)} teamB={teamName(teams, m.teamBId)}
                onConfirm={(id) => (
                  <form action={confirm}><input type="hidden" name="matchId" value={m.id} /><input type="hidden" name="submissionId" value={id} /><SubmitButton className="rounded bg-emerald-700 px-2 py-1 text-xs text-white">Confirm this</SubmitButton></form>
                )} />
              <p className="mt-2 text-xs text-slate-600">Or enter the result yourself below in the list.</p>
            </MatchCard>
          ))}
        </section>
      )}
      <nav className="flex gap-2 text-sm">
        {['open', 'done', 'all'].map((f) => <a key={f} href={`/admin/${slug}/matches?filter=${f}`} className={`rounded px-2 py-1 ${f === filter ? 'bg-slate-900 text-white' : 'border'}`}>{f}</a>)}
      </nav>
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((m) => (
          <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} startedAt={startedAtById[m.id]} capMinutes={settingsOf(m).timeCapMinutes} pausedAt={pauseById[m.id]?.at ?? null} pausedMs={pauseById[m.id]?.ms ?? 0}>
            {(m.status === 'ready' || m.status === 'live') && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
              <form action={court} className="flex flex-wrap items-center gap-2 text-xs">
                <input type="hidden" name="matchId" value={m.id} />
                <label>Court
                  <select name="court" defaultValue="" className="ml-1 rounded border p-1">
                    <option value="">auto</option>
                    {Array.from({ length: t.court_count }, (_, i) => i + 1).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                {m.status === 'ready'
                  ? <SubmitButton name="op" value="start" className="rounded border px-2 py-1">Start now</SubmitButton>
                  : (
                    <>
                      <SubmitButton name="op" value="move" className="rounded border px-2 py-1">Move</SubmitButton>
                      <SubmitButton name="op" value="off" className="rounded border px-2 py-1">Take off court</SubmitButton>
                    </>
                  )}
              </form>
              {m.status === 'live' && (
                <form action={clock} className="text-xs">
                  <input type="hidden" name="matchId" value={m.id} />
                  {pauseById[m.id]?.at
                    ? <SubmitButton name="op" value="resume" className="rounded border border-amber-500 px-2 py-1 text-amber-800">Resume</SubmitButton>
                    : <SubmitButton name="op" value="pause" className="rounded border px-2 py-1">Pause</SubmitButton>}
                </form>
              )}
              </div>
            )}
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
            {m.teamAId && m.teamBId && m.status !== 'pending' && (
              <ScoreForm matchId={m.id} settings={settingsOf(m)} existing={games[m.id] ?? []} teamA={teams.find((x) => x.id === m.teamAId)?.name ?? '?'} teamB={teams.find((x) => x.id === m.teamBId)?.name ?? '?'} action={enterResultForm.bind(null, slug)} submitLabel={m.status === 'done' ? 'Edit result' : 'Save result'} successText="Result saved" confirmMessage={m.status === 'done' ? 'This match already has a result. Re-entering it will reset every later match that depended on it. Continue?' : undefined} />
            )}
          </MatchCard>
        ))}
        {shown.length === 0 && <p className="text-sm text-slate-500">Nothing here.</p>}
      </div>
    </div>
  );
}

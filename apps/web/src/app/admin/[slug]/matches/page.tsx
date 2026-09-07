import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { assignCourt, enterResult, confirmSubmission } from '@/actions/matches';
import { gamesFromForm } from '@/lib/results/form';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listGames, listMatches, listPools, listSubmissions, listTeams, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { MatchCard, teamName } from '@/components/MatchCard';
import { ScoreForm } from '@/components/ScoreForm';
import { SubmissionCompare } from '@/components/SubmissionCompare';
import { FlashMessage } from '@/components/FlashMessage';

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
  const gamesPerMatchById: Record<string, number> = Object.fromEntries(matches.map((m) => [m.id, settingsOf(m).gamesPerMatch]));
  const games = gamesByMatch(gameRows);
  const latest = latestByMatch(subs);
  const shown = matches.filter((m) => filter === 'all' ? true : filter === 'done' ? m.status === 'done' : m.status !== 'done' && m.status !== 'pending');
  const attention = matches.filter((m) => m.status === 'submitted' || m.status === 'disputed');
  const label = (m: typeof matches[number]) => m.stage === 'pool' ? `${pools.find((p) => p.id === m.poolId)?.name ?? 'Pool'} · #${m.slot}` : `Round ${m.round} · #${m.slot}`;
  const here = `/admin/${slug}/matches?filter=${filter}`;

  async function court(formData: FormData) {
    'use server';
    const raw = String(formData.get('court') ?? '');
    redirectWithMsg(here, await assignCourt(slug, String(formData.get('matchId')), raw === '' ? null : Number(raw)), 'Court updated');
  }
  async function score(formData: FormData) {
    'use server';
    const matchId = String(formData.get('matchId'));
    const gs = gamesFromForm(formData, gamesPerMatchById[matchId] ?? 1);
    redirectWithMsg(here, await enterResult(slug, matchId, gs), 'Result saved');
  }
  async function confirm(formData: FormData) {
    'use server';
    redirectWithMsg(here, await confirmSubmission(slug, String(formData.get('matchId')), String(formData.get('submissionId'))), 'Result confirmed');
  }

  return (
    <div className="space-y-4">
      <FlashMessage />
      {attention.length > 0 && (
        <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
          <h2 className="font-semibold">Needs attention ({attention.length})</h2>
          {attention.map((m) => (
            <MatchCard key={m.id} match={m} teams={teams} games={[]} label={`${label(m)} · ${m.status}`}>
              <SubmissionCompare a={latest[m.id]?.a} b={latest[m.id]?.b} teamA={teamName(teams, m.teamAId)} teamB={teamName(teams, m.teamBId)}
                onConfirm={(id) => (
                  <form action={confirm}><input type="hidden" name="matchId" value={m.id} /><input type="hidden" name="submissionId" value={id} /><button className="rounded bg-emerald-700 px-2 py-1 text-xs text-white">Confirm this</button></form>
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
          <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)}>
            {(m.status === 'ready' || m.status === 'live') && (
              <form action={court} className="mb-2 flex items-center gap-2 text-xs">
                <input type="hidden" name="matchId" value={m.id} />
                <label>Court
                  <select name="court" defaultValue={m.court ?? ''} className="ml-1 rounded border p-1">
                    <option value="">none</option>
                    {Array.from({ length: t.court_count }, (_, i) => i + 1).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <button className="rounded border px-2 py-1">Send to court</button>
              </form>
            )}
            {m.teamAId && m.teamBId && m.status !== 'pending' && (
              <ScoreForm matchId={m.id} settings={settingsOf(m)} existing={games[m.id] ?? []} teamA={teams.find((x) => x.id === m.teamAId)?.name ?? '?'} teamB={teams.find((x) => x.id === m.teamBId)?.name ?? '?'} action={score} submitLabel={m.status === 'done' ? 'Edit result' : 'Save result'} confirmMessage={m.status === 'done' ? 'This match already has a result. Re-entering it will reset every later match that depended on it. Continue?' : undefined} />
            )}
          </MatchCard>
        ))}
        {shown.length === 0 && <p className="text-sm text-slate-500">Nothing here.</p>}
      </div>
    </div>
  );
}

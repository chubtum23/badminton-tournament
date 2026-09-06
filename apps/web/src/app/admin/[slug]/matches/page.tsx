import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { assignCourt, enterResult, gamesFromForm } from '@/actions/matches';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listGames, listMatches, listPools, listTeams } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFromTournament } from '@/lib/db/mappers';
import { MatchCard } from '@/components/MatchCard';
import { ScoreForm } from '@/components/ScoreForm';

export default async function MatchesAdminPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string; filter?: string }> }) {
  const { slug } = await params;
  const { msg, filter = 'open' } = await searchParams;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [pools, teams, matchRows, gameRows] = await Promise.all([
    listPools(ctx.sb, t.id), listTeams(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id),
  ]);
  const settings = settingsFromTournament(t);
  const matches = matchRows.map(rowToMatch);
  const games = gamesByMatch(gameRows);
  const shown = matches.filter((m) => filter === 'all' ? true : filter === 'done' ? m.status === 'done' : m.status !== 'done' && m.status !== 'pending');
  const label = (m: typeof matches[number]) => m.stage === 'pool' ? `${pools.find((p) => p.id === m.poolId)?.name ?? 'Pool'} · #${m.slot}` : `Round ${m.round} · #${m.slot}`;
  const here = `/admin/${slug}/matches?filter=${filter}`;

  async function court(formData: FormData) {
    'use server';
    const raw = String(formData.get('court') ?? '');
    redirectWithMsg(here, await assignCourt(slug, String(formData.get('matchId')), raw === '' ? null : Number(raw)), 'Court updated');
  }
  async function score(formData: FormData) {
    'use server';
    const gs = await gamesFromForm(formData, settings.gamesPerMatch);
    redirectWithMsg(here, await enterResult(slug, String(formData.get('matchId')), gs), 'Result saved');
  }

  return (
    <div className="space-y-4">
      {msg && <p className="rounded bg-slate-100 p-2 text-sm">{msg}</p>}
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
              <ScoreForm matchId={m.id} settings={settings} existing={games[m.id] ?? []} teamA={teams.find((x) => x.id === m.teamAId)?.name ?? '?'} teamB={teams.find((x) => x.id === m.teamBId)?.name ?? '?'} action={score} submitLabel={m.status === 'done' ? 'Edit result' : 'Save result'} confirmMessage={m.status === 'done' ? 'This match already has a result. Re-entering it will reset every later match that depended on it. Continue?' : undefined} />
            )}
          </MatchCard>
        ))}
        {shown.length === 0 && <p className="text-sm text-slate-500">Nothing here.</p>}
      </div>
    </div>
  );
}

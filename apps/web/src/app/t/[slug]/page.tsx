import { notFound } from 'next/navigation';
import { liveBoard } from '@tournament/core';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadTournamentBundle, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { MatchCard, pendingFor } from '@/components/MatchCard';

export const dynamic = 'force-dynamic';

export default async function LivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  const { tournament: t, pools, teams } = bundle;
  const matches = bundle.matches.map(rowToMatch);
  const games = gamesByMatch(bundle.games);
  const stage = t.status === 'knockout' || t.status === 'finished' ? 'knockout' : 'pool';
  const board = liveBoard(matches, stage, pools.map((p) => p.id));
  const poolName = (m: typeof matches[number]) => pools.find((p) => p.id === m.poolId)?.name ?? 'Pool';
  const label = (m: typeof matches[number]) => m.stage === 'pool' ? poolName(m)
    : m.stage === 'playoff' ? `${poolName(m)} · playoff`
    : `Round ${m.round}`;
  // Match carries no timestamps, so the live clock reads started_at off the raw rows.
  const startedAtById: Record<string, string | null> = Object.fromEntries(bundle.matches.map((r) => [r.id, r.started_at]));
  const capOf = (m: typeof matches[number]) => settingsFor(t, m.stage).timeCapMinutes;
  const latest = latestByMatch(bundle.submissions);
  const pending = (m: typeof matches[number]) => pendingFor(latest, teams, m);
  // Submitted/disputed matches are neither "now playing" nor "up next", so without this section a
  // match that has been played but not yet confirmed vanishes from the live tab entirely.
  const awaiting = matches.filter((m) => m.status === 'submitted' || m.status === 'disputed');
  const seeded = teams.filter((x) => x.seed !== null).sort((x, y) => (x.seed ?? 0) - (y.seed ?? 0));
  // Most recently completed first. Rows written before finished_at existed have a null stamp and
  // sort last, keeping them out of the way of anything with a real completion time.
  const recent = bundle.matches
    .filter((r) => r.status === 'done' && r.team_a_id && r.team_b_id)
    .sort((x, y) => (y.finished_at ?? '').localeCompare(x.finished_at ?? ''))
    .slice(0, 6)
    .map(rowToMatch);

  return (
    <div className="space-y-6">
      {bundle.announcements.filter((a) => a.pinned).map((a) => (
        <div key={a.id} className="rounded border border-amber-400 bg-amber-50 p-3 text-sm whitespace-pre-wrap">{a.body}</div>
      ))}
      {t.status === 'setup' && <p className="rounded border bg-white p-4 text-sm">Pools have not been drawn yet. Check back soon.</p>}
      <section>
        <h2 className="mb-2 font-semibold">Now playing</h2>
        {board.nowPlaying.length === 0 ? <p className="text-sm text-slate-500">No match on court right now.</p> : (
          <div className="grid gap-3 md:grid-cols-2">{board.nowPlaying.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} pending={pending(m)} startedAt={startedAtById[m.id]} capMinutes={capOf(m)} />)}</div>
        )}
      </section>
      {awaiting.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Awaiting confirmation</h2>
          <div className="grid gap-3 md:grid-cols-2">{awaiting.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} pending={pending(m)} />)}</div>
        </section>
      )}
      <section>
        <h2 className="mb-2 font-semibold">Up next</h2>
        {board.upNext.length === 0 ? <p className="text-sm text-slate-500">Nothing queued.</p> : (
          <div className="grid gap-3 md:grid-cols-2">{board.upNext.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={[]} label={label(m)} pending={pending(m)} />)}</div>
        )}
      </section>
      {seeded.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Top seeds</h2>
          <ol className="flex flex-wrap gap-2 text-sm">{seeded.map((x) => <li key={x.id} className="rounded border bg-white px-2 py-1"><span className="mr-1 rounded bg-amber-100 px-1 text-xs">#{x.seed}</span>{x.name}</li>)}</ol>
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Latest results</h2>
          <div className="grid gap-3 md:grid-cols-2">{recent.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} />)}</div>
        </section>
      )}
    </div>
  );
}

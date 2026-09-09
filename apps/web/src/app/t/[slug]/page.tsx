import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { gameSlotsByMatch, loadTournamentBundle, latestByMatch } from '@/lib/db/queries';
import { gamesByMatch, rowToMatch, settingsFor } from '@/lib/db/mappers';
import { scheduleBoard } from '@/lib/schedule/board';
import { pairNames } from '@/lib/teams/roster';
import { MatchCard, pendingFor } from '@/components/MatchCard';
import { NowPlaying } from '@/components/NowPlaying';
import { poolTone, ui } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function LivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const bundle = await loadTournamentBundle(sb, slug);
  if (!bundle) notFound();
  const { tournament: t, pools, teams } = bundle;
  const matches = bundle.matches.map(rowToMatch);
  const games = gamesByMatch(bundle.games);
  const slots = gameSlotsByMatch(bundle.games);
  const stage = t.status === 'knockout' || t.status === 'finished' ? 'knockout' : 'pool';
  // A court holds one game, so the board is a list of games rather than of meetings.
  const board = scheduleBoard({ tournament: t, matches, slots: bundle.games, poolOrder: pools.map((p) => p.id), stage });
  const poolName = (m: typeof matches[number]) => pools.find((p) => p.id === m.poolId)?.name ?? 'Pool';
  const label = (m: typeof matches[number]) => m.stage === 'pool' ? poolName(m)
    : m.stage === 'playoff' ? `${poolName(m)} · playoff`
    : `Round ${m.round}`;
  const settingsOf = (m: typeof matches[number]) => settingsFor(t, m.stage);
  // Pool colour, so a card is placed at a glance. A knockout meeting has no pool and stays neutral.
  const tone = (m: typeof matches[number]) => {
    const i = pools.findIndex((p) => p.id === m.poolId);
    return i >= 0 ? poolTone(i).head : undefined;
  };
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
  const nameOf = (id: string | null) => (id ? teams.find((x) => x.id === id)?.name ?? '?' : 'TBD');
  // "Alex & Priya · Sam & Jo" for the pair each side fields in that game; null until both rosters are set.
  const pairLine = (m: typeof matches[number], gameNo: number) => {
    const a = teams.find((x) => x.id === m.teamAId), b = teams.find((x) => x.id === m.teamBId);
    const pa = a ? pairNames(a, gameNo) : null, pb = b ? pairNames(b, gameNo) : null;
    return pa || pb ? `${pa ?? '—'} · ${pb ?? '—'}` : null;
  };

  return (
    <div className="space-y-7">
      {bundle.announcements.filter((a) => a.pinned).map((a) => (
        <div key={a.id} className={`${ui.card} ${ui.headOrange} whitespace-pre-wrap border-orange px-7 py-6 text-base font-semibold`}>{a.body}</div>
      ))}
      {t.status === 'setup' && <p className={ui.empty}>Pools have not been drawn yet. Check back soon.</p>}

      <NowPlaying tournament={t} games={board.nowPlaying} teams={teams} settings={settingsOf} />

      {awaiting.length > 0 && (
        <section className="space-y-4">
          <h2 className={ui.h2}>Awaiting confirmation <span className="text-muted-soft">({awaiting.length})</span></h2>
          <div className="grid gap-6 md:grid-cols-2">
            {awaiting.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} tone={tone(m)} pending={pending(m)} tournament={t} slots={slots[m.id]} />)}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className={ui.h2}>Up next <span className="text-muted-soft">({board.upNext.length})</span></h2>
        {board.upNext.length === 0 ? <p className={ui.empty}>Nothing queued.</p> : (
          <ol className={ui.card}>
            {board.upNext.map((g) => {
              const pairs = pairLine(g.match, g.slot.game_no);
              return (
                <li key={`${g.slot.match_id}:${g.slot.game_no}`} className="border-b-hair border-line-soft px-7 py-5 last:border-b-0">
                  <span className={`${ui.eyebrow} text-muted`}>{label(g.match)} · {g.label}</span>
                  <span className="mt-1 block font-display text-xl font-extrabold uppercase">
                    {nameOf(g.match.teamAId)} <span className="font-sans text-base font-medium lowercase text-line-strong">vs</span> {nameOf(g.match.teamBId)}
                  </span>
                  {pairs && <span className="mt-0.5 block text-xs text-muted">{pairs}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {seeded.length > 0 && (
        <section className="space-y-4">
          <h2 className={ui.h2}>Top seeds</h2>
          <ol className="flex flex-wrap gap-2.5">
            {seeded.map((x) => (
              <li key={x.id} className="flex items-center gap-2 border-hair border-navy bg-white px-4 py-3 text-base font-bold">
                <span className="bg-orange-tint px-1.5 text-[11px] font-bold text-orange-ink">#{x.seed}</span>{x.name}
              </li>
            ))}
          </ol>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-4">
          <h2 className={ui.h2}>Latest results <span className="text-muted-soft">({recent.length})</span></h2>
          <div className="grid gap-6 md:grid-cols-2">
            {recent.map((m) => <MatchCard key={m.id} match={m} teams={teams} games={games[m.id] ?? []} label={label(m)} tone={tone(m)} tournament={t} slots={slots[m.id]} />)}
          </div>
        </section>
      )}
    </div>
  );
}

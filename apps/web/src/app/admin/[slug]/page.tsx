import Link from 'next/link';
import { redirect } from 'next/navigation';
import { validateRoster } from '@tournament/core';
import { requireAdmin } from '@/actions/guard';
import { lockPools, unlockPools } from '@/actions/pools';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listMatches, listPools, listTeamsWithPlayers } from '@/lib/db/queries';
import { settingsFor } from '@/lib/db/mappers';
import { rosterOf } from '@/lib/teams/roster';
import { hubTiles } from '@/lib/admin/hub';
import { FlashMessage } from '@/components/FlashMessage';
import { SubmitButton } from '@/components/SubmitButton';
import { ui } from '@/components/ui';

export default async function HubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [teams, pools, matches] = await Promise.all([listTeamsWithPlayers(ctx.sb, t.id), listPools(ctx.sb, t.id), listMatches(ctx.sb, t.id)]);
  const s = settingsFor(t, 'pool');
  const rules = `${s.gamesPerMatch} games to ${s.pointsPerGame}${s.timeCapMinutes ? ` · ${s.timeCapMinutes} min clock` : ''} · ${t.court_count} courts · top ${t.advance_per_pool} per pool`;
  const tiles = hubTiles({
    status: t.status, startsAt: t.starts_at, venue: t.venue, rules,
    teamCount: teams.length, completeCount: teams.filter((x) => validateRoster(rosterOf(x)).ok).length, signupOpen: t.signup_open,
    poolCount: pools.length, meetingCount: matches.filter((m) => m.stage === 'pool').length, liveCount: 0, championName: null,
  });
  const teamsTile = tiles.find((x) => x.key === 'teams')!;
  // lockPools does its own checking and names the offending team; this only decides whether the
  // button is worth offering, and says which of the two things is still missing.
  // A team that signs up after the draw has no pool, so Lock would fail with "1 team(s) not in a
  // pool". Catch that here and say what to do about it.
  const unpooled = teams.filter((x) => !x.withdrawn && x.pool_id === null);
  const strandedByLateSignup = pools.length > 0 && unpooled.length > 0;
  const canLock = t.status === 'setup' && teamsTile.pill === 'Done' && pools.length > 0 && !strandedByLateSignup;
  const resultCount = matches.filter((m) => m.status === 'done').length;
  const pill = (p: string) => (p === 'Done' ? ui.pillDone : p === 'Locked' ? ui.pillLocked : ui.pillTodo);

  async function lock() { 'use server'; redirectWithMsg(`/admin/${slug}`, await lockPools(slug), 'Pools locked and matches created'); }
  async function unlock() { 'use server'; redirectWithMsg(`/admin/${slug}`, await unlockPools(slug), 'Pools unlocked'); }

  return (
    <div className="space-y-5">
      <FlashMessage />
      <p className="text-base text-slate-700">{t.status === 'setup' ? 'Get these four things done, then lock the pools.' : 'Everything is set. Run the night from Matches.'}</p>
      <ol className="space-y-3">
        {tiles.map((tile) => (
          <li key={tile.key}>
            <Link href={`/admin/${slug}${tile.href}`} data-testid={`tile-${tile.key}`} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-5 hover:bg-slate-50">
              <span><span className="block text-lg font-semibold">{tile.title}</span><span className="block text-sm text-slate-600">{tile.summary}</span></span>
              <span className={pill(tile.pill)}>{tile.pill}</span>
            </Link>
          </li>
        ))}
      </ol>
      {t.status === 'setup' && (
        <form action={lock} className="space-y-1">
          <SubmitButton disabled={!canLock} className={`${ui.primary} disabled:opacity-50`}>Lock pools and create matches</SubmitButton>
          {!canLock && <p className={ui.help}>{pools.length === 0
            ? 'Draw the pools first (tile 4).'
            : strandedByLateSignup
              ? 'A team signed up after the draw. Re-deal the pools, or move them into one on the Standings page.'
              : 'Every team needs two men and one woman, and you need at least 2 teams.'}</p>}
        </form>
      )}
      {t.status === 'pools' && (
        <div className="flex flex-wrap gap-3">
          <Link href={`/admin/${slug}/draw`} className={ui.primary}>Start the knockout</Link>
          <form action={unlock}>
            <SubmitButton confirmMessage={`Unlock the pools? This deletes the draw${resultCount ? ` and ${resultCount} entered result${resultCount === 1 ? '' : 's'}` : ''}, and returns the tournament to setup.`} className={ui.danger}>Unlock pools</SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

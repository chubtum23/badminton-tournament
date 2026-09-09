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
  // The tiles are a real sequence — you cannot draw pools before you have teams — so the step
  // number is set as a figure rather than left buried in the title.
  const step = (title: string) => {
    const m = /^(\d+)\.\s*(.*)$/.exec(title);
    return m ? { n: m[1]!, rest: m[2]! } : { n: '', rest: title };
  };

  async function lock() { 'use server'; redirectWithMsg(`/admin/${slug}`, await lockPools(slug), 'Pools locked and matches created'); }
  async function unlock() { 'use server'; redirectWithMsg(`/admin/${slug}`, await unlockPools(slug), 'Pools unlocked'); }

  return (
    <div className="space-y-6">
      <FlashMessage />
      <p className="text-[15px] text-muted-strong">
        {t.status === 'setup' ? 'Get these four things done, then lock the pools.' : 'Everything is set. Run the night from Matches.'}
      </p>
      <ol className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => {
          const { n, rest } = step(tile.title);
          return (
            <li key={tile.key}>
              <Link
                href={`/admin/${slug}${tile.href}`}
                data-testid={`tile-${tile.key}`}
                className={`${ui.card} flex h-full flex-col justify-between gap-6 px-7 py-7 hover:border-orange`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className={`${ui.figure} text-6xl text-navy`}>{n}</span>
                  <span className={pill(tile.pill)}>{tile.pill}</span>
                </span>
                <span>
                  <span className="block font-display text-xl font-extrabold uppercase tracking-tight">{rest}</span>
                  <span className="mt-1.5 block text-base text-muted">{tile.summary}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      {t.status === 'setup' && (
        <form action={lock} className="space-y-2">
          <SubmitButton disabled={!canLock} className={`${ui.primary} disabled:opacity-50`}>Lock pools and create matches</SubmitButton>
          {!canLock && <p className={ui.help}>{pools.length === 0
            ? 'Draw the pools first (step 4).'
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

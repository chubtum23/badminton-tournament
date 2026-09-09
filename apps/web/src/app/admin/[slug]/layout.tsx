import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { signOut } from '@/app/login/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { LocalDateTime } from '@/components/LocalDateTime';
import { Shell, ShellLink } from '@/components/Shell';
import { listGames, listMatches, listTeams } from '@/lib/db/queries';
import { statusLine } from '@/lib/admin/hub';

const tabs = [
  ['', 'Home'], ['/teams', 'Teams'], ['/matches', 'Matches'], ['/standings', 'Standings'], ['/draw', 'Draw'], ['/announcements', 'Announcements'],
] as const;

export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [teams, matches, games] = await Promise.all([listTeams(ctx.sb, t.id), listMatches(ctx.sb, t.id), listGames(ctx.sb, t.id)]);
  const final = matches.find((m) => m.stage === 'knockout' && m.next_match_id === null);
  const line = statusLine({
    status: t.status,
    teamCount: teams.length,
    liveCount: games.filter((g) => g.started_at !== null && g.score_a === null).length,
    championName: teams.find((x) => x.id === final?.winner_id)?.name ?? null,
  });
  // Date and venue join the status line rather than taking a line of their own: the band is the
  // one thing on screen the organiser reads at a glance, and it should stay one line deep.
  const when = t.starts_at ? <LocalDateTime iso={t.starts_at} compact /> : null;
  return (
    <Shell
      title={t.name}
      status={<>{line}{when && <> · {when}</>}{t.venue && <> · {t.venue}</>}</>}
      links={
        <>
          <ShellLink href={`/t/${slug}`}>Public page</ShellLink>
          <form action={signOut}><SubmitButton className="uppercase tracking-label text-onnavy-soft hover:text-bone">Sign out</SubmitButton></form>
        </>
      }
      tabs={tabs.map(([path, label]) => ({ href: `/admin/${slug}${path}`, label }))}
    >
      {children}
    </Shell>
  );
}

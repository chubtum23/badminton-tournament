import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { signOut } from '@/app/login/actions';
import { SubmitButton } from '@/components/SubmitButton';
import { LocalDateTime } from '@/components/LocalDateTime';
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
  return (
    <div className="mx-auto max-w-5xl p-4 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t.name}</h1>
          <p className="text-sm text-slate-600">
            {t.starts_at && <LocalDateTime iso={t.starts_at} />}{t.starts_at && t.venue ? ' · ' : ''}{t.venue}
          </p>
          <p className="mt-1 text-base font-semibold text-slate-800">{line} · <Link className="font-normal underline" href={`/t/${slug}`}>public page</Link></p>
        </div>
        <form action={signOut}><SubmitButton className="text-sm underline">Sign out</SubmitButton></form>
      </header>
      <nav className="flex flex-wrap gap-1 border-b">
        {tabs.map(([path, label]) => (
          <Link key={label} href={`/admin/${slug}${path}`} className="rounded-t-lg px-4 py-3 text-base font-medium hover:bg-slate-100">{label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

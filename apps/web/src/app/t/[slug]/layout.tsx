import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug } from '@/lib/db/queries';
import { currentParticipant } from '@/lib/participant/token';
import { RealtimeRefresh } from '@/components/RealtimeRefresh';
import { LocalDateTime } from '@/components/LocalDateTime';

export const dynamic = 'force-dynamic';

export default async function PublicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const t = await getTournamentBySlug(sb, slug);
  if (!t) notFound();
  const me = await currentParticipant(slug);
  const tabs: Array<readonly [string, string]> = [['', 'Live'], ['/pools', 'Pools'], ['/bracket', 'Bracket'], ['/announcements', 'Announcements']];
  if (me) tabs.push(['/team', `My team: ${me.team.name}`]);
  if (t.status === 'setup' && t.signup_open && !me) tabs.push(['/join', 'Join']);
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t.name}</h1>
        {(t.starts_at || t.venue) && (
          <p className="text-sm text-slate-600">
            {t.starts_at && <LocalDateTime iso={t.starts_at} />}
            {t.starts_at && t.venue ? ' · ' : ''}
            {t.venue}
          </p>
        )}
        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          <span>{t.status === 'setup' ? 'Starting soon' : t.status === 'pools' ? 'Pool stage' : t.status === 'knockout' ? 'Knockout' : 'Finished'}</span>
          <RealtimeRefresh tournamentId={t.id} />
        </p>
      </header>
      <nav className="flex gap-2 border-b">
        {tabs.map(([path, label]) => <Link key={label} href={`/t/${slug}${path}`} className="px-3 py-2 text-sm hover:bg-slate-100">{label}</Link>)}
      </nav>
      {children}
    </div>
  );
}

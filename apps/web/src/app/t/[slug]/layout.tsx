import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug } from '@/lib/db/queries';
import { currentParticipant } from '@/lib/participant/token';
import { RealtimeRefresh } from '@/components/RealtimeRefresh';
import { LocalDateTime } from '@/components/LocalDateTime';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

const STAGE: Record<string, string> = { setup: 'Starting soon', pools: 'Pool stage', knockout: 'Knockout', finished: 'Finished' };

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
    <Shell
      title={t.name}
      status={
        <>
          {STAGE[t.status] ?? t.status}
          {t.starts_at && <> · <LocalDateTime iso={t.starts_at} compact /></>}
          {t.venue && <> · {t.venue}</>}
        </>
      }
      links={<RealtimeRefresh tournamentId={t.id} />}
      tabs={tabs.map(([path, label]) => ({ href: `/t/${slug}${path}`, label }))}
    >
      {children}
    </Shell>
  );
}

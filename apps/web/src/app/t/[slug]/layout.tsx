import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug, listAnnouncements } from '@/lib/db/queries';
import { AnnouncementBanner } from '@/components/AnnouncementBanner';
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
  const [me, announcements] = await Promise.all([currentParticipant(slug), listAnnouncements(sb, t.id)]);
  // The list comes pinned-first, so the newest post has to be picked out rather than taken from the top.
  const latest = announcements.reduce<(typeof announcements)[number] | null>((a, b) => (!a || b.created_at > a.created_at ? b : a), null);
  const tabs: Array<readonly [string, string]> = [['', 'Live'], ['/pools', 'Pools'], ['/bracket', 'Bracket'], ['/teams', 'Teams'], ['/players', 'Power leaderboard'], ['/announcements', 'Announcements']];
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
      notice={<AnnouncementBanner slug={slug} latest={latest && { created_at: latest.created_at, body: latest.body }} />}
    >
      {children}
    </Shell>
  );
}

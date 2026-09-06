import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug, listAnnouncements } from '@/lib/db/queries';
import { AnnouncementList } from '@/components/AnnouncementList';

export const dynamic = 'force-dynamic';

export default async function AnnouncementsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const t = await getTournamentBySlug(sb, slug);
  if (!t) notFound();
  return <AnnouncementList items={await listAnnouncements(sb, t.id)} />;
}

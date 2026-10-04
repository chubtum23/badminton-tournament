import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { listTeamsWithPlayers } from '@/lib/db/queries';
import { sideFromTeam } from '@/lib/results/freeSheet';
import { FreeScoreSheet } from '@/components/FreeScoreSheet';

export default async function ScoreSheetAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const teams = await listTeamsWithPlayers(ctx.sb, ctx.tournament.id);
  return (
    <FreeScoreSheet slug={slug}
      teams={teams.filter((t) => !t.withdrawn).map(sideFromTeam)} />
  );
}

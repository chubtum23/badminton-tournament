import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireAdmin } from '@/actions/guard';
import { getEditTokens } from '@/actions/teams';
import { listTeamsWithPlayers } from '@/lib/db/queries';
import { siteOrigin } from '@/lib/siteUrl';
import { TeamsAdmin } from '@/components/TeamsAdmin';
import { FlashMessage } from '@/components/FlashMessage';

export default async function TeamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const [teams, tokens, hdrs, code] = await Promise.all([
    listTeamsWithPlayers(ctx.sb, t.id),
    getEditTokens(slug),
    headers(),
    ctx.sb.rpc('tournament_join_code', { t: t.id }),
  ]);
  if (code.error) throw new Error(code.error.message);
  const baseUrl = siteOrigin(hdrs);
  return (
    <div className="space-y-6">
      <FlashMessage />
      <TeamsAdmin slug={slug} tournament={t} teams={teams} tokens={tokens} baseUrl={baseUrl} joinCode={String(code.data ?? '')} />
    </div>
  );
}

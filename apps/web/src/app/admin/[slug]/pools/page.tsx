import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { generatePools, lockPools, moveTeam } from '@/actions/pools';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listPools, listTeams } from '@/lib/db/queries';
import { FlashMessage } from '@/components/FlashMessage';

export default async function PoolsAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const [pools, teams] = await Promise.all([listPools(ctx.sb, ctx.tournament.id), listTeams(ctx.sb, ctx.tournament.id)]);
  const editable = ctx.tournament.status === 'setup';

  async function generate(formData: FormData) {
    'use server';
    redirectWithMsg(`/admin/${slug}/pools`, await generatePools(slug, Number(formData.get('poolCount'))), 'Pools generated');
  }
  async function move(formData: FormData) {
    'use server';
    redirectWithMsg(`/admin/${slug}/pools`, await moveTeam(slug, String(formData.get('teamId')), String(formData.get('poolId'))), 'Team moved');
  }
  async function lock() {
    'use server';
    redirectWithMsg(`/admin/${slug}/pools`, await lockPools(slug), 'Pools locked and matches created');
  }

  return (
    <div className="space-y-4">
      <FlashMessage />
      {editable && (
        <form action={generate} className="flex items-end gap-2 rounded border bg-white p-4 text-sm">
          <label>Number of pools
            <input name="poolCount" type="number" min={1} max={teams.length} defaultValue={Math.max(1, Math.round(teams.length / 4))} className="mt-1 w-24 rounded border p-2" />
          </label>
          <button className="rounded bg-slate-900 px-4 py-2 text-white">{pools.length ? 'Re-deal randomly' : 'Generate pools'}</button>
          <span className="text-slate-500">{teams.length} teams. Placement is random; seeds are labels only.</span>
        </form>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {pools.map((p) => (
          <section key={p.id} className="rounded border bg-white p-4">
            <h2 className="mb-2 font-semibold">{p.name}</h2>
            <ul className="space-y-1 text-sm">
              {teams.filter((t) => t.pool_id === p.id).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span>{t.seed && <span className="mr-1 rounded bg-amber-100 px-1 text-xs">#{t.seed}</span>}{t.name}</span>
                  {editable && (
                    <form action={move} className="flex gap-1">
                      <input type="hidden" name="teamId" value={t.id} />
                      <select name="poolId" defaultValue={p.id} className="rounded border p-1 text-xs">
                        {pools.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      <button className="rounded border px-2 text-xs">Move</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {editable && pools.length > 0 && (
        <form action={lock}>
          <button className="rounded bg-emerald-700 px-4 py-2 text-white">Lock pools and create matches</button>
          <p className="mt-1 text-xs text-slate-500">This cannot be undone. Settings and teams lock too.</p>
        </form>
      )}
    </div>
  );
}

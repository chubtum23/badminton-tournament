import { requireAdmin } from '@/actions/guard';
import { updateSettings } from '@/actions/tournaments';
import { redirect } from 'next/navigation';

export default async function SetupPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { slug } = await params;
  const { msg } = await searchParams;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  const locked = t.status !== 'setup';

  async function save(formData: FormData) {
    'use server';
    const r = await updateSettings(slug, formData);
    redirect(`/admin/${slug}?msg=${encodeURIComponent(r.ok ? 'Settings saved' : r.message ?? r.error)}`);
  }

  return (
    <div className="space-y-6">
      {msg && <p className="rounded bg-slate-100 p-2 text-sm">{msg}</p>}
      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-semibold">Settings {locked && <span className="text-xs font-normal text-slate-500">(locked after setup)</span>}</h2>
        <form action={save} className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <label>Games per match<input name="gamesPerMatch" type="number" defaultValue={t.games_per_match} disabled={locked} className="mt-1 w-full rounded border p-2" /></label>
          <label>Points per game<input name="pointsPerGame" type="number" defaultValue={t.points_per_game} disabled={locked} className="mt-1 w-full rounded border p-2" /></label>
          <label>Points cap (blank = none)<input name="maxPoints" type="number" defaultValue={t.max_points ?? ''} disabled={locked} className="mt-1 w-full rounded border p-2" /></label>
          <label>Courts<input name="courtCount" type="number" defaultValue={t.court_count} disabled={locked} className="mt-1 w-full rounded border p-2" /></label>
          <label>Advance per pool<input name="advancePerPool" type="number" defaultValue={t.advance_per_pool} disabled={locked} className="mt-1 w-full rounded border p-2" /></label>
          <label className="flex items-end gap-2 pb-2"><input name="winByTwo" type="checkbox" defaultChecked={t.win_by_two} disabled={locked} /> Win by two</label>
          {!locked && <div className="col-span-full"><button className="rounded bg-slate-900 px-4 py-2 text-white">Save settings</button></div>}
        </form>
      </section>
    </div>
  );
}

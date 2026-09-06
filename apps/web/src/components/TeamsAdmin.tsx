import { redirect } from 'next/navigation';
import { addTeams, deleteTeam, regenerateToken, setSeed } from '@/actions/teams';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { ConfirmButton } from './ConfirmButton';

export function TeamsAdmin({ slug, teams, tokens, locked, baseUrl }: {
  slug: string; teams: TeamWithPlayers[]; tokens: Record<string, string>; locked: boolean; baseUrl: string;
}) {
  async function add(formData: FormData) {
    'use server';
    const r = await addTeams(slug, formData);
    redirect(`/admin/${slug}?msg=${encodeURIComponent(r.ok ? `Added ${r.data.added} team(s)` : r.message ?? r.error)}`);
  }
  async function seed(formData: FormData) {
    'use server';
    const raw = String(formData.get('seed') ?? '').trim();
    const r = await setSeed(slug, String(formData.get('teamId')), raw === '' ? null : Number(raw));
    redirect(`/admin/${slug}?msg=${encodeURIComponent(r.ok ? 'Seed saved' : r.message ?? r.error)}`);
  }
  async function remove(formData: FormData) {
    'use server';
    const r = await deleteTeam(slug, String(formData.get('teamId')));
    redirect(`/admin/${slug}?msg=${encodeURIComponent(r.ok ? 'Team removed' : r.message ?? r.error)}`);
  }
  async function regen(formData: FormData) {
    'use server';
    const r = await regenerateToken(slug, String(formData.get('teamId')));
    redirect(`/admin/${slug}?msg=${encodeURIComponent(r.ok ? 'New link generated' : r.message ?? r.error)}`);
  }

  return (
    <section className="rounded border bg-white p-4 space-y-4">
      <h2 className="font-semibold">Teams ({teams.length})</h2>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500"><th>Team</th><th>Players</th><th>Seed</th><th>Private link</th><th></th></tr></thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.id} className="border-t align-top">
              <td className="py-2 font-medium"><span className="mr-1 inline-block h-3 w-3 rounded-full" style={{ background: t.colour }} />{t.name}</td>
              <td className="py-2">{t.players.map((p) => p.name).join(' & ')}</td>
              <td className="py-2">
                <form action={seed} className="flex gap-1">
                  <input type="hidden" name="teamId" value={t.id} />
                  <input name="seed" type="number" min={1} max={64} defaultValue={t.seed ?? ''} className="w-16 rounded border p-1" />
                  <button className="rounded border px-2">Set</button>
                </form>
              </td>
              <td className="py-2">
                {tokens[t.id] ? (
                  <div className="flex flex-col gap-1">
                    <code className="break-all text-xs">{baseUrl}/t/{slug}/team/{tokens[t.id]}</code>
                    <form action={regen}><input type="hidden" name="teamId" value={t.id} /><button className="text-xs underline">Regenerate</button></form>
                  </div>
                ) : <span className="text-xs text-slate-400">n/a</span>}
              </td>
              <td className="py-2">
                {!locked && (
                  <form action={remove}>
                    <input type="hidden" name="teamId" value={t.id} />
                    <ConfirmButton message={`Remove ${t.name} and their players? This cannot be undone.`} className="text-xs text-red-700 underline">Remove</ConfirmButton>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!locked && (
        <form action={add} className="space-y-2">
          <label className="block text-sm">Add teams, one per line (<code>Alice &amp; Bob</code>, or <code>Alice &amp; Bob = Team Name</code>)
            <textarea name="lines" rows={5} className="mt-1 w-full rounded border p-2 font-mono text-xs" />
          </label>
          <button className="rounded bg-slate-900 px-4 py-2 text-white">Add teams</button>
        </form>
      )}
    </section>
  );
}

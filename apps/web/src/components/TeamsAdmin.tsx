import { redirect } from 'next/navigation';
import { deleteTeam, regenerateToken, reinstateTeam, setSeed, withdrawTeam } from '@/actions/teams';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { SubmitButton } from './SubmitButton';

export function TeamsAdmin({ slug, teams, tokens, locked, baseUrl }: {
  slug: string; teams: TeamWithPlayers[]; tokens: Record<string, string>; locked: boolean; baseUrl: string;
}) {
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
  async function withdraw(formData: FormData) {
    'use server';
    const r = await withdrawTeam(slug, String(formData.get('teamId')));
    redirect(`/admin/${slug}?msg=${encodeURIComponent(r.ok ? 'Team withdrawn' : r.message ?? r.error)}`);
  }
  async function reinstate(formData: FormData) {
    'use server';
    const r = await reinstateTeam(slug, String(formData.get('teamId')));
    redirect(`/admin/${slug}?msg=${encodeURIComponent(r.ok ? 'Team reinstated' : r.message ?? r.error)}`);
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
              <td className="py-2 font-medium">
                <span className={t.withdrawn ? 'text-slate-400 line-through' : undefined}>
                  <span className="mr-1 inline-block h-3 w-3 rounded-full" style={{ background: t.colour }} />{t.name}
                </span>
                {t.withdrawn && <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] uppercase text-slate-600">withdrawn</span>}
              </td>
              <td className="py-2">{t.players.map((p) => p.name).join(' & ')}</td>
              <td className="py-2">
                <form action={seed} className="flex gap-1">
                  <input type="hidden" name="teamId" value={t.id} />
                  <input name="seed" type="number" min={1} max={64} defaultValue={t.seed ?? ''} className="w-16 rounded border p-1" />
                  <SubmitButton className="rounded border px-2">Set</SubmitButton>
                </form>
              </td>
              <td className="py-2">
                {tokens[t.id] ? (
                  <div className="flex flex-col gap-1">
                    <code className="break-all text-xs">{baseUrl}/t/{slug}/team/{tokens[t.id]}</code>
                    <form action={regen}><input type="hidden" name="teamId" value={t.id} /><SubmitButton className="text-xs underline">Regenerate</SubmitButton></form>
                  </div>
                ) : <span className="text-xs text-slate-400">n/a</span>}
              </td>
              <td className="py-2 space-y-1">
                {t.withdrawn ? (
                  <form action={reinstate}>
                    <input type="hidden" name="teamId" value={t.id} />
                    <SubmitButton className="text-xs underline">Reinstate</SubmitButton>
                  </form>
                ) : (
                  <form action={withdraw}>
                    <input type="hidden" name="teamId" value={t.id} />
                    <SubmitButton confirmMessage={`Withdraw ${t.name}? Their open matches are forfeited to the opponent.`} className="text-xs text-red-700 underline">Withdraw</SubmitButton>
                  </form>
                )}
                {!locked && (
                  <form action={remove}>
                    <input type="hidden" name="teamId" value={t.id} />
                    <SubmitButton confirmMessage={`Remove ${t.name} and their players? This cannot be undone.`} className="text-xs text-red-700 underline">Remove</SubmitButton>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

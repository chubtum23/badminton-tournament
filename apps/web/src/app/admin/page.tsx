import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { createTournament } from '@/actions/tournaments';
import { signOut } from '@/app/login/actions';
import { LocalDateTimeInput } from '@/components/LocalDateTime';
import { SubmitButton } from '@/components/SubmitButton';
import type { TournamentRow } from '@/lib/db/types';

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const sb = await createServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/login');
  const { data: adminRows } = await sb.from('tournament_admins').select('tournament_id');
  const ids = (adminRows ?? []).map((r) => r.tournament_id as string);
  const { data: tournaments } = ids.length
    ? await sb.from('tournaments').select('*').in('id', ids).order('created_at', { ascending: false })
    : { data: [] as TournamentRow[] };

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My tournaments</h1>
        <form action={signOut}><SubmitButton className="text-sm underline">Sign out</SubmitButton></form>
      </div>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <ul className="divide-y rounded border bg-white">
        {(tournaments ?? []).map((t) => (
          <li key={t.id} className="flex items-center justify-between p-3">
            <div>
              <div className="font-medium">{t.name}</div>
              <div className="text-xs text-slate-500">/{t.slug} · {t.status}</div>
            </div>
            <div className="flex gap-3 text-sm">
              <Link className="underline" href={`/t/${t.slug}`}>Public</Link>
              <Link className="underline" href={`/admin/${t.slug}`}>Manage</Link>
            </div>
          </li>
        ))}
        {(tournaments ?? []).length === 0 && <li className="p-3 text-sm text-slate-500">No tournaments yet.</li>}
      </ul>
      <form action={createTournament} className="space-y-3 rounded border bg-white p-4">
        <h2 className="font-semibold">Create a tournament</h2>
        <label className="block text-sm">Name
          <input name="name" required className="mt-1 w-full rounded border p-2" placeholder="Spring Club Night" />
        </label>
        <label className="block text-sm">URL slug (optional)
          <input name="slug" className="mt-1 w-full rounded border p-2" placeholder="spring-club-night" />
        </label>
        <label className="block text-sm">Date and time (optional)
          <LocalDateTimeInput name="startsAt" className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block text-sm">Venue (optional)
          <input name="venue" maxLength={120} className="mt-1 w-full rounded border p-2" placeholder="Northcote Leisure Centre" />
        </label>
        <SubmitButton className="rounded bg-slate-900 px-4 py-2 text-white">Create</SubmitButton>
      </form>
    </main>
  );
}

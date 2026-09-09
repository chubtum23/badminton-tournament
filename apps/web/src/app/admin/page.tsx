import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { createTournament } from '@/actions/tournaments';
import { signOut } from '@/app/login/actions';
import { LocalDateTimeInput } from '@/components/LocalDateTime';
import { SubmitButton } from '@/components/SubmitButton';
import { PlainShell } from '@/components/Shell';
import { ui } from '@/components/ui';
import { TOURNAMENT_PUBLIC_COLUMNS, type TournamentRow } from '@/lib/db/types';

const STAGE: Record<string, string> = { setup: 'Setting up', pools: 'Pool stage', knockout: 'Knockout', finished: 'Finished' };

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const sb = await createServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect('/login');
  const { data: adminRows } = await sb.from('tournament_admins').select('tournament_id');
  const ids = (adminRows ?? []).map((r) => r.tournament_id as string);
  const { data: tournaments } = ids.length
    ? await sb.from('tournaments').select(TOURNAMENT_PUBLIC_COLUMNS).in('id', ids).order('created_at', { ascending: false })
    : { data: [] as TournamentRow[] };
  const list = tournaments ?? [];

  return (
    <PlainShell
      title="My tournaments"
      status={`${list.length} tournament${list.length === 1 ? '' : 's'}`}
      links={<form action={signOut}><SubmitButton className="uppercase tracking-label text-onnavy-soft hover:text-bone">Sign out</SubmitButton></form>}
    >
      <div className="space-y-6">
        {error && <p role="alert" className={ui.alarm}>{error}</p>}

        {list.length === 0 ? (
          <p className={ui.empty}>No tournaments yet. Create your first one below.</p>
        ) : (
          <ul className="space-y-4">
            {list.map((t) => (
              <li key={t.id} className={ui.card}>
                <div className={`${ui.head} ${ui.headOrange}`}>
                  <span className={ui.eyebrow}>{STAGE[t.status] ?? t.status}</span>
                  <span className={`${ui.eyebrow} text-muted`}>/{t.slug}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 px-7 py-6">
                  <span className="font-display text-2xl font-extrabold uppercase">{t.name}</span>
                  <span className="flex flex-wrap gap-2">
                    <Link href={`/t/${t.slug}`} className={ui.secondary}>Public</Link>
                    <Link href={`/admin/${t.slug}`} className={ui.solid}>Manage</Link>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <section className={ui.card}>
          <div className={ui.head}><span className={ui.eyebrow}>Create a tournament</span></div>
          <form action={createTournament} className={`${ui.body} space-y-4`}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={ui.label}>Name<input name="name" required className={ui.field} placeholder="Spring Club Night" /></label>
              <label className={ui.label}>URL slug <span className="font-normal normal-case tracking-normal text-muted">(optional)</span>
                <input name="slug" className={ui.field} placeholder="spring-club-night" />
              </label>
              <label className={ui.label}>Date and time <span className="font-normal normal-case tracking-normal text-muted">(optional)</span>
                <LocalDateTimeInput name="startsAt" className={ui.field} />
              </label>
              <label className={ui.label}>Venue <span className="font-normal normal-case tracking-normal text-muted">(optional)</span>
                <input name="venue" maxLength={120} className={ui.field} placeholder="Northcote Leisure Centre" />
              </label>
            </div>
            <SubmitButton className={ui.primary}>Create</SubmitButton>
          </form>
        </section>
      </div>
    </PlainShell>
  );
}

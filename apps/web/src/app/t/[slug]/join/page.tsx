import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug } from '@/lib/db/queries';
import { signUpTeam } from '@/actions/signup';
import { JoinForm } from '@/components/JoinForm';
import { ui } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const t = await getTournamentBySlug(sb, slug);
  if (!t) notFound();
  const open = t.status === 'setup' && t.signup_open;
  // The join code column is hidden from clients, so ask the database whether one is set.
  const needs = await sb.rpc('signup_needs_code', { p_slug: slug });
  return (
    <section className={ui.card}>
      <h2 className="text-2xl font-bold">Sign your team up</h2>
      {open ? (
        <>
          <p className={`${ui.help} mb-6`}>One person signs the whole team up: a team name and your three players. You get a private team link at the end.</p>
          <JoinForm slug={slug} needsCode={Boolean(needs.data)} action={signUpTeam.bind(null, slug)} />
        </>
      ) : (
        <p className="mt-2 text-base">Sign-ups are closed. Ask the organiser to add your team.</p>
      )}
    </section>
  );
}

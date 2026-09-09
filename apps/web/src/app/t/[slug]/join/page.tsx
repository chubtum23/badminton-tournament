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
  if (!open) {
    return (
      <section className={`${ui.card} max-w-2xl`}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <h2 className={ui.eyebrow}>Sign your team up</h2>
          <span className={ui.eyebrow}>Closed</span>
        </div>
        <p className={`${ui.body} text-sm`}>Sign-ups are closed. Ask the organiser to add your team.</p>
      </section>
    );
  }
  // The join code column is hidden from clients, so ask the database whether one is set. A failure
  // here has to be loud: rendering the form without the code field would look like an open sign-up
  // and every attempt would then be rejected by the database.
  const needs = await sb.rpc('signup_needs_code', { p_slug: slug });
  if (needs.error) throw new Error(`signup_needs_code: ${needs.error.message}`);
  return (
    <section className={`${ui.card} max-w-3xl`}>
      <div className={`${ui.head} ${ui.headOrange}`}>
        <h2 className={ui.eyebrow}>Sign your team up</h2>
        <span className={ui.eyebrow}>Open</span>
      </div>
      <div className={ui.body}>
        <p className="mb-6 text-[13px] text-muted">One person signs the whole team up: a team name and your three players. You get a private team link at the end.</p>
        <JoinForm slug={slug} needsCode={Boolean(needs.data)} action={signUpTeam.bind(null, slug)} />
      </div>
    </section>
  );
}

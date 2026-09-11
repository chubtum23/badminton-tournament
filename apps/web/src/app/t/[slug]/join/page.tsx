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
    // A single sentence does not want the full width, so the closed notice stays a narrow card.
    return (
      <section className={`${ui.card} max-w-prose`}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <h2 className={ui.eyebrow}>Sign your team up</h2>
          <span className={ui.eyebrow}>Closed</span>
        </div>
        {/* Before the draw the organiser can still enter a team by hand; after it nobody can. */}
        <p className={`${ui.body} text-[15px]`}>
          {t.status === 'setup'
            ? 'Sign-ups are closed. Ask the organiser to add your team.'
            : 'Sign-ups are closed: the draw has been made, so no more teams can join.'}
        </p>
      </section>
    );
  }
  // The join code column is hidden from clients, so ask the database whether one is set. A failure
  // here has to be loud: rendering the form without the code field would look like an open sign-up
  // and every attempt would then be rejected by the database.
  const needs = await sb.rpc('signup_needs_code', { p_slug: slug });
  if (needs.error) throw new Error(`signup_needs_code: ${needs.error.message}`);
  // Signing up is the only thing on this page and it is what a player came for, so the card takes
  // the whole shell rather than sitting in a column with the screen empty beside it.
  return (
    <section className={ui.card}>
      <div className={`${ui.head} ${ui.headOrange} px-9 py-6`}>
        <h2 className={ui.h2}>Sign your team up</h2>
        <span className={ui.eyebrow}>Open</span>
      </div>
      <div className="px-9 py-10">
        <p className="mb-10 max-w-prose text-lg text-muted">One person signs the whole team up: a team name and your three players. You get a private team link at the end.</p>
        <JoinForm slug={slug} needsCode={Boolean(needs.data)} action={signUpTeam.bind(null, slug)} />
      </div>
    </section>
  );
}

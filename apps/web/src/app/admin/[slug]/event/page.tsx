import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { updateEvent } from '@/actions/tournaments';
import { redirectBackOnSuccess } from '@/actions/redirectWithMsg';
import { BackLink } from '@/components/BackLink';
import { FlashMessage } from '@/components/FlashMessage';
import { LocalDateTimeInput } from '@/components/LocalDateTime';
import { SubmitButton } from '@/components/SubmitButton';
import { ui } from '@/components/ui';

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  async function save(fd: FormData) { 'use server'; redirectBackOnSuccess(`/admin/${slug}/event`, `/admin/${slug}`, await updateEvent(slug, fd), 'Event details saved'); }
  return (
    <div className="max-w-prose space-y-6">
      <BackLink href={`/admin/${slug}`}>Setup checklist</BackLink>
      <FlashMessage />
      <section className={ui.card}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <h2 className={ui.eyebrow}>Event details</h2>
          <span className={ui.eyebrow}>Step 1</span>
        </div>
        <div className={ui.body}>
          <p className="mb-6 text-[15px] text-muted">Shown under the tournament name on every public page. You can change these at any time.</p>
          <form action={save} className="space-y-6">
            <label className={ui.label}>Date and time<LocalDateTimeInput name="startsAt" defaultIso={t.starts_at} className={ui.field} /><span className={ui.help}>In your own timezone.</span></label>
            <label className={ui.label}>Venue<input name="venue" maxLength={120} defaultValue={t.venue ?? ''} className={ui.field} /><span className={ui.help}>Hall or club name, as players know it.</span></label>
            <SubmitButton className={ui.primary}>Save event details</SubmitButton>
          </form>
        </div>
      </section>
    </div>
  );
}

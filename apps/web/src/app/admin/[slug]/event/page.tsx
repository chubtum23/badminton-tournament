import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { updateEvent } from '@/actions/tournaments';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { FlashMessage } from '@/components/FlashMessage';
import { LocalDateTimeInput } from '@/components/LocalDateTime';
import { SubmitButton } from '@/components/SubmitButton';
import { ui } from '@/components/ui';

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const t = ctx.tournament;
  async function save(fd: FormData) { 'use server'; redirectWithMsg(`/admin/${slug}/event`, await updateEvent(slug, fd), 'Event details saved'); }
  return (
    <section className={ui.card}>
      <FlashMessage />
      <h2 className="text-2xl font-bold">Event details</h2>
      <p className={`${ui.help} mb-6`}>Shown under the tournament name on every public page. You can change these at any time.</p>
      <form action={save} className="max-w-xl space-y-5">
        <label className={ui.label}>Date and time<LocalDateTimeInput name="startsAt" defaultIso={t.starts_at} className={ui.field} /><span className={ui.help}>In your own timezone.</span></label>
        <label className={ui.label}>Venue<input name="venue" maxLength={120} defaultValue={t.venue ?? ''} className={ui.field} /><span className={ui.help}>Hall or club name, as players know it.</span></label>
        <SubmitButton className={ui.primary}>Save event details</SubmitButton>
      </form>
    </section>
  );
}

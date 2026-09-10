import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { deleteAnnouncement, postAnnouncement, togglePinned } from '@/actions/announcements';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listAnnouncements } from '@/lib/db/queries';
import { AnnouncementList } from '@/components/AnnouncementList';
import { SubmitButton } from '@/components/SubmitButton';
import { FlashMessage } from '@/components/FlashMessage';
import { ui } from '@/components/ui';

export default async function AnnouncementsAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  const items = await listAnnouncements(ctx.sb, ctx.tournament.id);
  const here = `/admin/${slug}/announcements`;

  async function post(formData: FormData) { 'use server'; redirectWithMsg(here, await postAnnouncement(slug, formData), 'Posted'); }
  async function pin(formData: FormData) { 'use server'; redirectWithMsg(here, await togglePinned(slug, String(formData.get('id'))), 'Updated'); }
  async function remove(formData: FormData) { 'use server'; redirectWithMsg(here, await deleteAnnouncement(slug, String(formData.get('id'))), 'Deleted'); }

  return (
    <div className="space-y-6">
      <FlashMessage />
      <section className={ui.card}>
        <div className={`${ui.head} px-9 py-6`}><h2 className={ui.h2}>New announcement</h2></div>
        <form action={post} className="space-y-6 px-9 py-9">
          <label className={ui.label}>
            <span className="sr-only">Announcement</span>
            <textarea
              name="body" rows={4} maxLength={1000} required
              placeholder="e.g. Round 2 starts in 10 minutes — kings and Test warm up now"
              className={`${ui.fieldLg} min-h-[140px] resize-y font-normal normal-case tracking-normal placeholder:text-muted-soft`}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className={`${ui.check} text-base`}><input type="checkbox" name="pinned" className={ui.checkbox} /> Pin to the top of the live page</label>
            <SubmitButton className={`${ui.primary} px-12 py-5 text-base`}>Post</SubmitButton>
          </div>
        </form>
      </section>
      <AnnouncementList items={items} actions={(a) => (
        <span className="flex gap-2">
          <form action={pin}><input type="hidden" name="id" value={a.id} /><SubmitButton className={ui.tiny}>{a.pinned ? 'Unpin' : 'Pin'}</SubmitButton></form>
          <form action={remove}><input type="hidden" name="id" value={a.id} /><SubmitButton confirmMessage="Delete this announcement?" className={`${ui.tiny} hover:border-red-400 hover:text-red-700`}>Delete</SubmitButton></form>
        </span>
      )} />
    </div>
  );
}

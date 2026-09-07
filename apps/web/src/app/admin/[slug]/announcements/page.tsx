import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { deleteAnnouncement, postAnnouncement, togglePinned } from '@/actions/announcements';
import { redirectWithMsg } from '@/actions/redirectWithMsg';
import { listAnnouncements } from '@/lib/db/queries';
import { AnnouncementList } from '@/components/AnnouncementList';
import { ConfirmButton } from '@/components/ConfirmButton';
import { FlashMessage } from '@/components/FlashMessage';

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
    <div className="space-y-4">
      <FlashMessage />
      <form action={post} className="space-y-2 rounded border bg-white p-4 text-sm">
        <label className="block">New announcement
          <textarea name="body" rows={3} maxLength={1000} required className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" name="pinned" /> Pin to the top of the live page</label>
        <button className="rounded bg-slate-900 px-4 py-2 text-white">Post</button>
      </form>
      <AnnouncementList items={items} actions={(a) => (
        <span className="flex gap-2">
          <form action={pin}><input type="hidden" name="id" value={a.id} /><button className="underline">{a.pinned ? 'Unpin' : 'Pin'}</button></form>
          <form action={remove}><input type="hidden" name="id" value={a.id} /><ConfirmButton message="Delete this announcement?" className="text-red-700 underline">Delete</ConfirmButton></form>
        </span>
      )} />
    </div>
  );
}

'use server';
import { requireAdmin } from './guard';
import { fail, ok, type ActionResult } from './errors';
import { revalidateTournament } from './revalidate';

export async function postAnnouncement(slug: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const body = String(formData.get('body') ?? '').trim();
  if (body.length < 1 || body.length > 1000) return fail('invalid_input', 'Announcement must be 1-1000 characters');
  const pinned = formData.get('pinned') !== null;
  const ins = await ctx.sb.from('announcements').insert({ tournament_id: ctx.tournament.id, body, pinned });
  if (ins.error) return fail('invalid_input', ins.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}

export async function togglePinned(slug: string, id: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const cur = await ctx.sb.from('announcements').select('pinned').eq('id', id).eq('tournament_id', ctx.tournament.id).maybeSingle();
  if (cur.error || !cur.data) return fail('invalid_input', 'Announcement not found');
  const upd = await ctx.sb.from('announcements').update({ pinned: !cur.data.pinned }).eq('id', id);
  if (upd.error) return fail('invalid_input', upd.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}

export async function deleteAnnouncement(slug: string, id: string): Promise<ActionResult> {
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) return fail('not_admin');
  const del = await ctx.sb.from('announcements').delete().eq('id', id).eq('tournament_id', ctx.tournament.id);
  if (del.error) return fail('invalid_input', del.error.message);
  revalidateTournament(slug);
  return ok(undefined);
}

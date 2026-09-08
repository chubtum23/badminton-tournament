import { revalidatePath } from 'next/cache';

/** Every page that renders tournament state. */
export function revalidateTournament(slug: string): void {
  for (const p of [
    `/admin/${slug}`, `/admin/${slug}/event`, `/admin/${slug}/rules`, `/admin/${slug}/teams`, `/admin/${slug}/matches`,
    `/admin/${slug}/standings`, `/admin/${slug}/draw`, `/admin/${slug}/announcements`,
    `/t/${slug}`, `/t/${slug}/pools`, `/t/${slug}/bracket`, `/t/${slug}/team`, `/t/${slug}/join`, `/t/${slug}/announcements`,
  ]) revalidatePath(p);
}

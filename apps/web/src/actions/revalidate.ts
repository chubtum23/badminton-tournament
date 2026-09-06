import { revalidatePath } from 'next/cache';

/** Every page that renders tournament state. */
export function revalidateTournament(slug: string): void {
  for (const p of [
    `/admin/${slug}`, `/admin/${slug}/matches`, `/admin/${slug}/bracket`, `/admin/${slug}/announcements`,
    `/t/${slug}`, `/t/${slug}/pools`, `/t/${slug}/bracket`, `/t/${slug}/team`, `/t/${slug}/announcements`,
  ]) revalidatePath(p);
}

import { redirect } from 'next/navigation';

/** The organiser's pool tables moved to /standings; old bookmarks and links still work. */
export default async function OldPoolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/standings`);
}

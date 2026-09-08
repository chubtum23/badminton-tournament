import { redirect } from 'next/navigation';

/** The knockout bracket moved to /draw; old bookmarks and links still work. */
export default async function OldBracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/admin/${slug}/draw`);
}

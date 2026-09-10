'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** How long after posting an announcement still counts as news. */
const FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * The strip under the header band that says something new has been posted. It stays until the
 * viewer opens the announcements page or dismisses it, and comes back for the next post. What has
 * been seen is remembered per browser; storage failing just means the strip shows again.
 */
export function AnnouncementBanner({ slug, latest }: {
  slug: string;
  latest: { created_at: string; body: string } | null;
}) {
  const pathname = usePathname();
  const href = `/t/${slug}/announcements`;
  const key = `seen-announcement:${slug}`;
  const onPage = pathname === href;
  // Hidden until mounted: whether it has been seen lives in localStorage, which the server can't read.
  const [seen, setSeen] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(key); } catch {}
    setSeen(stored);
  }, [key]);

  const markSeen = () => {
    if (!latest) return;
    try { localStorage.setItem(key, latest.created_at); } catch {}
    setSeen(latest.created_at);
  };

  // Opening the announcements page counts as reading it.
  useEffect(() => {
    if (onPage && latest && seen !== undefined && seen !== latest.created_at) markSeen();
  }, [onPage, latest?.created_at, seen]);

  if (!latest || onPage || seen === undefined) return null;
  if (seen && seen >= latest.created_at) return null;
  if (Date.now() - new Date(latest.created_at).getTime() > FRESH_MS) return null;

  const preview = latest.body.replace(/\s+/g, ' ').trim();
  return (
    <div data-testid="announcement-banner" role="status" className="border-b-2 border-navy bg-orange text-ink">
      <div className="mx-auto flex max-w-shell items-center gap-4 px-6 py-3 sm:px-10">
        <Link href={href} onClick={markSeen} className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
          <span className="shrink-0 text-[13px] font-bold uppercase tracking-eyebrow">New announcement</span>
          <span className="min-w-0 truncate text-[15px] font-semibold">{preview}</span>
          <span className="shrink-0 text-[13px] font-bold uppercase tracking-label">Read it →</span>
        </Link>
        <button type="button" onClick={markSeen} aria-label="Dismiss" className="shrink-0 px-2 text-xl font-bold leading-none hover:text-navy">
          ×
        </button>
      </div>
    </div>
  );
}

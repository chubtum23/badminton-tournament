'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * The `?msg=` banner every action redirects to. Reading it on the client rather than from the
 * server component's `searchParams` means a realtime `router.refresh()` (or any other re-render
 * that does not change the URL) cannot wipe the outcome the user just triggered.
 */
function Banner() {
  const msg = useSearchParams().get('msg');
  if (!msg) return null;
  return <p className="border-l-4 border-navy bg-white px-4 py-3 text-[13px] font-semibold text-ink">{msg}</p>;
}

export function FlashMessage() {
  // These pages are all dynamic, but useSearchParams needs a boundary if that ever changes.
  return <Suspense fallback={null}><Banner /></Suspense>;
}

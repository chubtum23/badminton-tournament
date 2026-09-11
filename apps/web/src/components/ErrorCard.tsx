'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { ui } from './ui';

/**
 * What every error boundary shows: one plain card with a way to retry and a way out.
 *
 * On the night an error is nearly always the venue wifi dropping a request, and realtime refreshes
 * every phone on every change, so the retry is the button that matters. `reset()` alone would only
 * re-render the client tree; refreshing first refetches the server components that actually threw.
 */
export function ErrorCard({ error, reset, backHref, backLabel }: {
  error: Error & { digest?: string };
  reset: () => void;
  backHref: string;
  backLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section data-testid="error-card" role="alert" className={`${ui.card} max-w-prose`}>
      <div className={`${ui.head} ${ui.headOrange}`}>
        <h2 className={ui.eyebrow}>Something went wrong</h2>
      </div>
      <div className={ui.body}>
        <p className="text-[15px]">This page couldn&apos;t load just now. It is usually a dropped connection or a busy moment on the wifi, so give it another go.</p>
        {/* The digest is what the server logged against this error; worth reading out to the organiser. */}
        {error.digest && <p className="mt-2 text-xs text-muted">Reference {error.digest}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => { router.refresh(); reset(); })}
            className={`${ui.primary} disabled:opacity-60`}
          >
            {pending ? 'Trying…' : 'Try again'}
          </button>
          <Link href={backHref} className={ui.secondary}>{backLabel}</Link>
        </div>
      </div>
    </section>
  );
}

'use client';
import { usePathname } from 'next/navigation';
import { ErrorCard } from '@/components/ErrorCard';
import { PlainShell } from '@/components/Shell';

/**
 * The catch-all boundary. It sits inside the root layout but outside every other one, so it is
 * what a player sees when a tournament's own layout fails (the band, the tabs, the banner), not
 * just a page. Such a player still wants their tournament rather than the organiser's front door.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const slug = /^\/t\/([^/]+)/.exec(usePathname() ?? '')?.[1];
  return (
    <PlainShell title="Club tournament">
      <ErrorCard
        error={error}
        reset={reset}
        backHref={slug ? `/t/${slug}` : '/'}
        backLabel={slug ? 'Back to the tournament' : 'Home'}
      />
    </PlainShell>
  );
}

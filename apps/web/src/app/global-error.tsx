'use client';
import './globals.css';
import { ErrorCard } from '@/components/ErrorCard';
import { PlainShell } from '@/components/Shell';

/**
 * The last resort, for when the root layout itself fails. It replaces that layout, so it brings
 * its own <html> and stylesheet; the self-hosted fonts are not loaded here and the system
 * fallbacks in the font stacks take over.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <PlainShell title="Club tournament">
          <ErrorCard error={error} reset={reset} backHref="/" backLabel="Home" />
        </PlainShell>
      </body>
    </html>
  );
}

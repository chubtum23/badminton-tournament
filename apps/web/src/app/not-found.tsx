import Link from 'next/link';
import { PlainShell } from '@/components/Shell';
import { ui } from '@/components/ui';

/**
 * Every 404, including an unknown tournament (its layout calls notFound(), which lands here). The
 * likeliest visitor followed a mistyped or out-of-date link, so the card says what to do about it.
 */
export default function NotFound() {
  return (
    <PlainShell title="Club tournament">
      <section data-testid="not-found" className={`${ui.card} max-w-prose`}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <h2 className={ui.eyebrow}>Page not found</h2>
          <span className={ui.eyebrow}>404</span>
        </div>
        <div className={ui.body}>
          <p className="font-display text-3xl font-black uppercase leading-tight tracking-tight">Nothing on this court</p>
          <p className="mt-4 text-[15px] text-muted">The link may be mistyped or out of date, or the tournament may have been taken down. Check the link with your organiser.</p>
          <Link href="/" className={`${ui.secondary} mt-6 inline-block`}>Home</Link>
        </div>
      </section>
    </PlainShell>
  );
}

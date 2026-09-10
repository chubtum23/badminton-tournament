import Link from 'next/link';
import { PlainShell } from '@/components/Shell';
import { ui } from '@/components/ui';

/**
 * The front door. Players arrive on a tournament's own link, so the only person who lands here is
 * whoever runs the night — the page is one card, and that card is the way in.
 */
export default function Home() {
  return (
    <PlainShell title="Club tournament" status="Run a night · Follow it live">
      <section className={ui.card}>
        <div className={`${ui.head} ${ui.headOrange} px-9 py-6`}>
          <h2 className={ui.h2}>GUGC admin</h2>
        </div>
        <div className="flex flex-col gap-10 px-9 py-12 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-prose">
            <p className="font-display text-4xl font-black uppercase leading-[1.05] tracking-tight sm:text-5xl">
              Run the club tournament
            </p>
            <p className="mt-5 text-lg text-muted">
              Set up the night, sign teams in, draw the pools and put games on court. Everyone else follows
              along live from the tournament link.
            </p>
          </div>
          <Link href="/admin" className={`${ui.primary} inline-block shrink-0 self-start px-12 py-5 text-base lg:self-auto`}>
            Admin sign in
          </Link>
        </div>
      </section>
    </PlainShell>
  );
}

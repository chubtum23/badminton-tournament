import Link from 'next/link';
import { ShellTabs } from './ShellTabs';

/**
 * The navy band at the top of every screen, and the page column under it.
 *
 * The band carries the tournament's name, one line of live status, whatever links belong to the
 * viewer (the organiser gets "sign out", a player gets the public page), and the tab strip. Its
 * faint vertical rules are court sidelines — the only ornament in the design, and the thing that
 * makes a hall screen recognisable from across the room.
 */
export function Shell({ title, status, links, tabs, children }: {
  title: string;
  /** The one status line under the title: stage, court, team count. */
  status?: React.ReactNode;
  /** Links at the top right of the band. */
  links?: React.ReactNode;
  tabs: readonly { href: string; label: string }[];
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="on-navy court-lines relative bg-navy text-bone">
        <div className="relative mx-auto max-w-shell px-5 pt-6 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-black uppercase leading-tight tracking-tight sm:text-[30px]">{title}</h1>
              {status && <p className="mt-0.5 text-[12.5px] font-semibold uppercase tracking-wide2 text-orange">{status}</p>}
            </div>
            {links && <div className="flex flex-wrap items-center gap-5 pb-1.5 text-[13px] font-semibold uppercase tracking-label">{links}</div>}
          </div>
          <ShellTabs tabs={tabs} />
        </div>
      </div>
      <main className="mx-auto max-w-shell px-5 pb-16 pt-7 sm:px-8">{children}</main>
    </>
  );
}

/** A link in the band's top-right corner. `tone="quiet"` is for the less important of two. */
export function ShellLink({ href, tone = 'loud', children }: { href: string; tone?: 'loud' | 'quiet'; children: React.ReactNode }) {
  return <Link href={href} className={tone === 'loud' ? 'text-sky-light hover:text-bone' : 'text-onnavy-soft hover:text-bone'}>{children}</Link>;
}

/**
 * The band's own version of a plain page — no tabs, no tournament. The sign-in screen and the
 * organiser's tournament list use it so the app never opens on an unbranded white page.
 */
export function PlainShell({ title, status, links, children }: {
  title: string; status?: React.ReactNode; links?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <>
      <div className="on-navy court-lines relative bg-navy text-bone">
        <div className="relative mx-auto flex max-w-shell flex-wrap items-end justify-between gap-4 px-5 py-7 sm:px-8">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-black uppercase leading-tight tracking-tight sm:text-[30px]">{title}</h1>
            {status && <p className="mt-0.5 text-[12.5px] font-semibold uppercase tracking-wide2 text-orange">{status}</p>}
          </div>
          {links && <div className="flex flex-wrap items-center gap-5 text-[13px] font-semibold uppercase tracking-label">{links}</div>}
        </div>
      </div>
      <main className="mx-auto max-w-shell px-5 pb-16 pt-7 sm:px-8">{children}</main>
    </>
  );
}

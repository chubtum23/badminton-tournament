'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The tab strip on the header band.
 *
 * A client component only so it can read the current path — a server layout cannot, and marking
 * the active tab from the URL is what keeps the strip honest when a page redirects (the old
 * /bracket and /pools routes both land on a different tab than the one clicked).
 *
 * The strip has no bottom border: it sits on the band's own edge, so the active orange tab reads
 * as a card pulled forward out of the navy rather than a button laid on top of it.
 */
export function ShellTabs({ tabs }: { tabs: readonly { href: string; label: string }[] }) {
  const path = usePathname();
  // The longest matching href wins, so /admin/x/teams marks Teams rather than Home.
  const active = tabs.reduce<string | null>(
    (best, t) => ((path === t.href || path.startsWith(`${t.href}/`)) && (best === null || t.href.length > best.length) ? t.href : best),
    null,
  );
  return (
    <nav className="-mb-px mt-7 flex w-fit max-w-full flex-wrap border-hair border-b-0 border-navy-line">
      {tabs.map((tab, i) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === active ? 'page' : undefined}
          className={`whitespace-nowrap px-6 py-4 text-sm font-bold uppercase tracking-label sm:px-8 ${
            i > 0 ? 'border-l-hair border-navy-line' : ''
          } ${tab.href === active ? 'bg-orange text-ink' : 'text-onnavy hover:text-bone'}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

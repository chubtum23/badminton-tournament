'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * The tab strip on the header band.
 *
 * A client component only so it can read the current path — a server layout cannot, and marking
 * the active tab from the URL is what keeps the strip honest when a page redirects (the old
 * /bracket and /pools routes both land on a different tab than the one clicked).
 *
 * The strip has no bottom border: it sits on the band's own edge, so the active orange tab reads
 * as a card pulled forward out of the navy rather than a button laid on top of it.
 *
 * On a phone the tabs never wrap. Wrapped rows of different lengths left the dividers and the
 * outer border ragged, so below `sm` the strip is one row that swipes sideways instead: the
 * active tab is scrolled into view, and a navy fade on either edge shows there is more that way.
 */
export function ShellTabs({ tabs }: { tabs: readonly { href: string; label: string }[] }) {
  const path = usePathname();
  // The longest matching href wins, so /admin/x/teams marks Teams rather than Home.
  const active = tabs.reduce<string | null>(
    (best, t) => ((path === t.href || path.startsWith(`${t.href}/`)) && (best === null || t.href.length > best.length) ? t.href : best),
    null,
  );

  const nav = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const update = () =>
      setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const current = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (current) el.scrollLeft = current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [active]);

  const fade = 'pointer-events-none absolute inset-y-0 w-10 from-navy to-transparent sm:hidden';
  return (
    <div className="relative -mb-px mt-7 sm:w-fit sm:max-w-full">
      <nav
        ref={nav}
        className="no-scrollbar relative flex overflow-x-auto border-hair border-b-0 border-navy-line sm:flex-wrap sm:overflow-visible"
      >
        {tabs.map((tab, i) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.href === active ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap px-5 py-4 text-sm font-bold uppercase tracking-label sm:px-8 ${
              i > 0 ? 'border-l-hair border-navy-line' : ''
            } ${tab.href === active ? 'bg-orange text-ink' : 'text-onnavy hover:text-bone'}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {edges.left && <span aria-hidden className={`${fade} left-0 bg-gradient-to-r`} />}
      {edges.right && <span aria-hidden className={`${fade} right-0 bg-gradient-to-l`} />}
    </div>
  );
}

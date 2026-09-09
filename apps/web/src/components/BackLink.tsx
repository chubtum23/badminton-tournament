import Link from 'next/link';

/**
 * The way out of a page that has no tab of its own.
 *
 * The Rules and Event pages are reached from the hub's checklist, so the tab strip marks Home
 * while you are on them and offers nothing that says "you came from somewhere". This is that
 * missing affordance: it sits above the card, reads as a step backwards rather than a button,
 * and always names where it goes so it is not a mystery arrow.
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      data-testid="back-link"
      className="inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-label text-muted hover:text-navy"
    >
      <span aria-hidden>&larr;</span>{children}
    </Link>
  );
}

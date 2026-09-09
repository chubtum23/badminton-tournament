/** Shown by the route-level loading.tsx files while a page's data is being fetched. */
export function PageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-8 text-xs font-bold uppercase tracking-eyebrow text-muted">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-navy border-t-transparent"
      />
      {label}
    </div>
  );
}

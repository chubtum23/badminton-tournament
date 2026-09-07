/** Shown by the route-level loading.tsx files while a page's data is being fetched. */
export function PageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-sm text-slate-500">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
      />
      {label}
    </div>
  );
}

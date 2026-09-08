/** One place for the organiser-friendly sizes: big labels, 44px inputs, one dark button per form. */
export const ui = {
  card: 'rounded-xl border bg-white p-5 md:p-6',
  h2: 'text-lg font-semibold',
  label: 'block text-base font-medium text-slate-800',
  help: 'mt-1 text-sm text-slate-600',
  field: 'mt-1 w-full rounded-lg border p-3 text-base',
  primary: 'rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white hover:bg-slate-700',
  secondary: 'rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50',
  danger: 'rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50',
  pillDone: 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800',
  pillTodo: 'rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800',
  pillLocked: 'rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700',
} as const;

import type { AnnouncementRow } from '@/lib/db/types';

export function AnnouncementList({ items, actions }: {
  items: AnnouncementRow[];
  /** Admin-only controls rendered per item. */
  actions?: (a: AnnouncementRow) => React.ReactNode;
}) {
  if (items.length === 0) return <p className="text-sm text-slate-500">No announcements yet.</p>;
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className={`rounded border bg-white p-3 text-sm ${a.pinned ? 'border-amber-400' : ''}`}>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>{a.pinned ? 'Pinned · ' : ''}{new Date(a.created_at).toLocaleString()}</span>
            {actions?.(a)}
          </div>
          <p className="whitespace-pre-wrap">{a.body}</p>
        </li>
      ))}
    </ul>
  );
}

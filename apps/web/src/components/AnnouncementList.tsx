import type { AnnouncementRow } from '@/lib/db/types';
import { ui } from './ui';

export function AnnouncementList({ items, actions }: {
  items: AnnouncementRow[];
  /** Admin-only controls rendered per item. */
  actions?: (a: AnnouncementRow) => React.ReactNode;
}) {
  if (items.length === 0) return <p className={ui.empty}>No announcements yet. Posts show up on the public live page instantly.</p>;
  return (
    <ul className="space-y-4">
      {items.map((a) => (
        <li key={a.id} className={ui.card}>
          <div className={`${ui.head} ${a.pinned ? ui.headOrange : 'text-muted'}`}>
            <span className={ui.eyebrow}>{a.pinned ? 'Pinned · ' : ''}{new Date(a.created_at).toLocaleString()}</span>
            {actions?.(a)}
          </div>
          <p className="whitespace-pre-wrap px-5 py-4 text-sm">{a.body}</p>
        </li>
      ))}
    </ul>
  );
}

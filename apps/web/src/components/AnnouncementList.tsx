import type { AnnouncementRow } from '@/lib/db/types';
import { LocalDateTime } from './LocalDateTime';
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
            {/* Formatted in the viewer's browser: the server's clock is UTC, the hall's is not. */}
            <span className={ui.eyebrow}>{a.pinned ? 'Pinned · ' : ''}<LocalDateTime iso={a.created_at} compact /></span>
            {actions?.(a)}
          </div>
          <p className="whitespace-pre-wrap px-7 py-6 text-base">{a.body}</p>
        </li>
      ))}
    </ul>
  );
}

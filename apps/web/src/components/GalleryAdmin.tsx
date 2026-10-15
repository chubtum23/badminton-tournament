'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reorderAlbums, reorderPhotos, syncGalleryNow, updateAlbum, updatePhotos } from '@/actions/gallery';
import type { GalleryItem } from '@/lib/gallery/items';
import { RetryImg } from './GalleryGrid';
import { ui } from './ui';

/** Runs sync passes until Drive and the gallery agree, reporting as it goes. */
export function SyncButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    let added = 0;
    let removed = 0;
    try {
      for (let pass = 0; pass < 50; pass++) {
        const res = await syncGalleryNow(slug);
        if (!res.ok) { setError(res.message ?? 'Sync failed'); return; }
        added += res.data.added;
        removed += res.data.removed;
        if (res.data.remaining === 0) break;
        setNote(`Reading photos… ${res.data.remaining.toLocaleString()} to go`);
      }
      setNote(added || removed ? `Up to date: ${added} added, ${removed} removed` : 'Up to date: no changes in Drive');
      router.refresh();
    } catch {
      setError('Sync failed; check your connection and try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => void run()} disabled={busy} className={ui.solid} data-testid="gallery-sync">
        {busy ? 'Syncing…' : 'Sync from Drive now'}
      </button>
      {note && <span className="text-[15px] text-ink">{note}</span>}
      {error && <p role="alert" className={ui.alarm}>{error}</p>}
    </div>
  );
}

export type AdminAlbum = { id: string; title: string; driveName: string; hasTitle: boolean; hidden: boolean; visible: number; total: number; cover: string | null };

/** Albums in order: rename, move up or down, hide, and a way into each one's arranger. */
export function AlbumManager({ slug, albums: initial }: { slug: string; albums: AdminAlbum[] }) {
  const router = useRouter();
  const [albums, setAlbums] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { setAlbums(initial); }, [initial]);

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) => start(async () => {
    setError(null);
    const res = await fn();
    if (!res.ok) setError(res.message ?? 'Could not save');
    router.refresh();
  });

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= albums.length) return;
    const next = [...albums];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setAlbums(next);
    act(() => reorderAlbums(slug, next.map((a) => a.id)));
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className={ui.alarm}>{error}</p>}
      <ul className="divide-y-hair divide-line border-hair border-line">
        {albums.map((a, i) => (
          <li key={a.id} className={`flex flex-wrap items-center gap-4 px-4 py-3 ${a.hidden ? 'bg-line-soft' : 'bg-white'}`} data-testid="admin-album">
            <div className="h-16 w-24 shrink-0 overflow-hidden bg-line-soft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a.cover && <img src={a.cover} alt="" referrerPolicy="no-referrer" className={`h-full w-full object-cover ${a.hidden ? 'opacity-40' : ''}`} />}
            </div>
            <div className="min-w-[12rem] flex-1">
              <input
                defaultValue={a.hasTitle ? a.title : ''} placeholder={a.driveName} maxLength={80} aria-label="Album name"
                className={`${ui.fieldSm} w-full font-semibold`}
                onBlur={(e) => { if (e.target.value.trim() !== (a.hasTitle ? a.title : '')) act(() => updateAlbum(slug, a.id, { title: e.target.value })); }}
              />
              <p className="mt-1 text-sm text-muted">
                {a.visible.toLocaleString()} photos{a.total > a.visible ? ` · ${a.total - a.visible} hidden` : ''} · Drive folder “{a.driveName}”{a.hidden ? ' · hidden from the public page' : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={ui.tiny} disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label="Move album up">↑</button>
              <button type="button" className={ui.tiny} disabled={pending || i === albums.length - 1} onClick={() => move(i, 1)} aria-label="Move album down">↓</button>
              <button type="button" className={ui.tiny} disabled={pending} onClick={() => act(() => updateAlbum(slug, a.id, { hidden: !a.hidden }))}>{a.hidden ? 'Show' : 'Hide'}</button>
              <Link href={`/admin/${slug}/photos/${a.id}`} className={`${ui.tiny} border-navy text-navy`}>Arrange photos →</Link>
            </div>
          </li>
        ))}
      </ul>
      <p className={ui.help}>Leave a name blank to use the Drive folder&apos;s name.</p>
    </div>
  );
}

/** Moves `ids` (kept in their current relative order) to sit before `beforeId`, or to the end when it is null. */
function moveBefore(items: GalleryItem[], ids: ReadonlySet<string>, beforeId: string | null): GalleryItem[] {
  if (beforeId !== null && ids.has(beforeId)) return items;
  const moving = items.filter((p) => ids.has(p.id));
  const rest = items.filter((p) => !ids.has(p.id));
  const at = beforeId === null ? rest.length : rest.findIndex((p) => p.id === beforeId);
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/**
 * One album, every photo (hidden ones greyed). Tap to select; with a selection, star it, hide it,
 * or move it. On a computer a photo can also be dragged; on a phone "Move" then tap the photo it
 * should go in front of. The order is saved with "Save order", so a slip can be undone by leaving.
 */
export function PhotoArranger({ slug, albumId, items: initial }: { slug: string; albumId: string; items: GalleryItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [placing, setPlacing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const reorder = (next: GalleryItem[]) => { setItems(next); setDirty(true); setSaved(null); };

  function tap(id: string) {
    if (placing) {
      reorder(moveBefore(items, selected, id));
      setPlacing(false);
      return;
    }
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function patch(p: { highlight?: boolean; hidden?: boolean }) {
    const ids = [...selected];
    start(async () => {
      setError(null);
      const res = await updatePhotos(slug, ids, p);
      if (!res.ok) { setError(res.message ?? 'Could not save'); return; }
      setItems((cur) => cur.map((x) => (selected.has(x.id) ? { ...x, ...p } : x)));
      setSelected(new Set());
      router.refresh();
    });
  }

  function saveOrder(ids: string[] | null) {
    start(async () => {
      setError(null);
      const res = await reorderPhotos(slug, albumId, ids);
      if (!res.ok) { setError(res.message ?? 'Could not save'); return; }
      setDirty(false);
      setSaved(ids === null ? 'Back to camera order' : 'Order saved');
      router.refresh();
    });
  }

  useEffect(() => { if (!dirty) setItems(initial); }, [initial, dirty]);

  const sel = items.filter((p) => selected.has(p.id));
  const allStarred = sel.length > 0 && sel.every((p) => p.highlight);
  const allHidden = sel.length > 0 && sel.every((p) => p.hidden);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-2 border-b-hair border-line bg-bone/95 px-2 py-3 backdrop-blur">
        {sel.length > 0 ? (
          <>
            <span className="mr-2 text-[15px] font-semibold text-ink">{sel.length} selected</span>
            <button type="button" className={ui.secondary} disabled={pending} onClick={() => patch({ highlight: !allStarred })}>{allStarred ? '☆ Unstar' : '★ Highlight'}</button>
            <button type="button" className={ui.secondary} disabled={pending} onClick={() => patch({ hidden: !allHidden })}>{allHidden ? 'Show' : 'Hide'}</button>
            <button type="button" className={placing ? ui.primary : ui.secondary} onClick={() => setPlacing((v) => !v)}>
              {placing ? 'Now tap where…' : 'Move'}
            </button>
            <button type="button" className={ui.secondary} onClick={() => reorder(moveBefore(items, selected, items[0]?.id ?? null))}>To start</button>
            <button type="button" className={ui.secondary} onClick={() => reorder(moveBefore(items, selected, null))}>To end</button>
            <button type="button" className={ui.tiny} onClick={() => { setSelected(new Set()); setPlacing(false); }}>Clear</button>
          </>
        ) : (
          <span className="text-[15px] text-muted">Tap photos to select them. On a computer you can also drag a photo to a new spot.</span>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          {saved && !dirty && <span className="self-center text-sm font-semibold text-navy">{saved}</span>}
          <button type="button" className={ui.tiny} disabled={pending} onClick={() => saveOrder(null)}>Reset to camera order</button>
          <button type="button" className={ui.primary} disabled={!dirty || pending} onClick={() => saveOrder(items.map((p) => p.id))} data-testid="arranger-save">
            {pending ? 'Saving…' : 'Save order'}
          </button>
        </span>
      </div>
      {error && <p role="alert" className={ui.alarm}>{error}</p>}

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
        {items.map((p, i) => {
          const on = selected.has(p.id);
          return (
            <li
              key={p.id}
              draggable
              onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { e.preventDefault(); setOverId(p.id); }}
              onDragLeave={() => setOverId((o) => (o === p.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) reorder(moveBefore(items, selected.has(dragId) ? selected : new Set([dragId]), p.id));
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              className={`relative ${overId === p.id && dragId !== p.id ? 'before:absolute before:-left-1.5 before:inset-y-0 before:w-1 before:bg-orange' : ''}`}
            >
              <button
                type="button" onClick={() => tap(p.id)} aria-pressed={on} aria-label={`Photo ${i + 1}${p.highlight ? ', highlight' : ''}${p.hidden ? ', hidden' : ''}`}
                data-testid="arranger-photo"
                className={`relative block aspect-square w-full overflow-hidden bg-line-soft ${on ? 'outline outline-4 -outline-offset-4 outline-orange' : ''} ${dragId === p.id ? 'opacity-40' : ''}`}
              >
                                <RetryImg src={p.thumb} alt="" loading="lazy" draggable={false}
                  className={`h-full w-full object-cover ${p.hidden ? 'opacity-35 grayscale' : ''}`} />
                <span className="absolute left-1 top-1 bg-navy/80 px-1.5 text-xs font-bold text-bone">{i + 1}</span>
                {p.highlight && <span className="absolute right-1 top-1 bg-orange px-1.5 text-xs font-bold text-ink">★</span>}
                {p.hidden && <span className="absolute bottom-1 left-1 bg-ink/80 px-1.5 text-[11px] font-bold uppercase text-bone">Hidden</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

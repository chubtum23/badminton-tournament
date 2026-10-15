'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadAlbumPage } from '@/actions/gallery';
import type { GalleryItem } from '@/lib/gallery/items';
import { RawLink, SavePhoto } from './SavePhoto';
import { ui } from './ui';

/**
 * Photos laid out in justified rows, each at its own shape: a portrait stays a portrait, and every
 * row runs edge to edge. Order is kept left to right, top to bottom, which is what lets the
 * organiser's arrangement read as arranged. Pure CSS: each photo grows in proportion to its aspect
 * ratio, and a spacer at the end stops the last row stretching.
 */
export function JustifiedGrid({ items, onOpen, rowClass = '[--row:130px] sm:[--row:210px] lg:[--row:250px]', overlay }: {
  items: readonly GalleryItem[];
  onOpen: (index: number) => void;
  rowClass?: string;
  /** Extra content drawn over a photo (the admin's badges). */
  overlay?: (item: GalleryItem, index: number) => ReactNode;
}) {
  return (
    <ul className={`flex flex-wrap gap-1.5 ${rowClass}`}>
      {items.map((p, i) => {
        const ratio = p.width / p.height;
        return (
          <li key={p.id} style={{ flexGrow: ratio, flexBasis: `calc(var(--row) * ${ratio})` }} className="relative">
            <button
              type="button" onClick={() => onOpen(i)} data-testid="gallery-photo" aria-label={`Open photo ${i + 1}`}
              className="group relative block w-full overflow-hidden bg-line-soft"
              style={{ paddingTop: `${100 / ratio}%` }}
            >
                            <RetryImg
                src={p.thumb} alt="" loading="lazy" decoding="async"
                className={`absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${p.hidden ? 'opacity-35 grayscale' : ''}`}
              />
            </button>
            {overlay?.(p, i)}
          </li>
        );
      })}
      <li aria-hidden style={{ flexGrow: 1e6, flexBasis: 0 }} />
    </ul>
  );
}

/** Full-screen viewer: arrows, swipe and keys to move, and the photo's downloads. */
export function PhotoViewer({ items, index, total, onIndex, onClose, onNeedMore }: {
  items: readonly GalleryItem[];
  index: number;
  total: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Called when stepping past the last loaded photo while more exist; resolves to how many arrived. */
  onNeedMore?: () => Promise<number>;
}) {
  const touchX = useRef<number | null>(null);
  const current = items[index];

  const step = useCallback((d: number) => {
    const next = index + d;
    if (next >= items.length && items.length < total && onNeedMore) {
      void onNeedMore().then((n) => onIndex(n > 0 ? next : 0));
      return;
    }
    onIndex((next + items.length) % items.length);
  }, [index, items.length, total, onNeedMore, onIndex]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; };
  }, [step, onClose]);

  if (!current) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Photo ${index + 1} of ${total}`} className="fixed inset-0 z-50 flex flex-col bg-[#10133A]" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-bone" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-bold uppercase tracking-label">{index + 1} / {total}</span>
        <button type="button" onClick={onClose} className="border-hair border-bone/60 px-5 py-3 text-sm font-bold uppercase tracking-label text-bone hover:border-bone">Close</button>
      </div>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4"
        onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const from = touchX.current;
          const to = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (from !== null && to !== undefined && Math.abs(to - from) > 50) step(to < from ? 1 : -1);
        }}
      >
        {/* The preview sits behind the big photo, so something shows at once while it loads. */}
                <RetryImg
          key={current.id} src={current.full} alt={`Photo ${index + 1}`}
          className="h-full w-full object-contain"
          style={{ backgroundImage: `url(${current.thumb})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }}
          onClick={(e) => e.stopPropagation()}
        />
        {total > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); step(-1); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-navy/70 px-4 py-6 text-2xl font-bold text-bone hover:bg-navy">‹</button>
            <button type="button" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); step(1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-navy/70 px-4 py-6 text-2xl font-bold text-bone hover:bg-navy">›</button>
          </>
        )}
      </div>
      {/* Saving sits at the bottom, under the thumb on a phone. */}
      <div className="flex flex-wrap items-start justify-center gap-3 border-t-hair border-bone/15 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" onClick={(e) => e.stopPropagation()}>
        <SavePhoto item={current} />
        {current.raw && <RawLink href={current.raw} />}
      </div>
    </div>
  );
}

/** A grid that pages in more photos on request, and opens the viewer. Used for an album and for highlights. */
export function GalleryView({ slug, albumId, initial, total: initialTotal, rowClass }: {
  slug: string;
  /** Null for a fixed list (highlights) that never pages. */
  albumId: string | null;
  initial: GalleryItem[];
  total: number;
  rowClass?: string;
}) {
  const [items, setItems] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  useEffect(() => { setItems(initial); setTotal(initialTotal); }, [initial, initialTotal]);

  const more = useCallback(async (): Promise<number> => {
    if (!albumId || loadingRef.current) return 0;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await loadAlbumPage(slug, albumId, items.length);
      const have = new Set(items.map((p) => p.id));
      const fresh = page.items.filter((p) => !have.has(p.id));
      setItems((cur) => [...cur, ...fresh]);
      setTotal(page.total);
      return fresh.length;
    } catch {
      return 0;
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [slug, albumId, items]);

  return (
    <div className="space-y-4">
      <JustifiedGrid items={items} onOpen={setOpen} rowClass={rowClass} />
      {albumId && items.length < total && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <button type="button" onClick={() => void more()} disabled={loading} className={ui.solid} data-testid="gallery-more">
            {loading ? 'Loading…' : 'Load more'}
          </button>
          <p className="text-sm text-muted">Showing {items.length.toLocaleString()} of {total.toLocaleString()}</p>
        </div>
      )}
      {open !== null && (
        <PhotoViewer items={items} index={open} total={total} onIndex={setOpen} onClose={() => setOpen(null)} onNeedMore={albumId ? more : undefined} />
      )}
    </div>
  );
}

/**
 * An <img> from Google that tries again if it fails. Drive answers a burst of requests with 429 for
 * a few seconds; without this, a fast scroll could leave holes that never fill in.
 */
export function RetryImg(props: React.ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [attempt, setAttempt] = useState(0);
  // A new fragment makes the browser fetch the same image again; Google ignores it.
  const src = attempt === 0 ? props.src : `${props.src}#retry${attempt}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      {...props}
      src={src}
      referrerPolicy="no-referrer"
      onError={(e) => {
        props.onError?.(e);
        if (attempt < 4) setTimeout(() => setAttempt((a) => a + 1), 1500 * (attempt + 1));
      }}
    />
  );
}

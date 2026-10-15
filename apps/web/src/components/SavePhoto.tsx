'use client';
import { useEffect, useRef, useState } from 'react';
import type { GalleryItem } from '@/lib/gallery/items';

type Platform = 'ios' | 'android' | 'desktop';
type State =
  | { kind: 'idle' }
  | { kind: 'loading'; pct: number | null }
  | { kind: 'ready' }
  | { kind: 'done' }
  | { kind: 'error' };

/**
 * iPhone and iPad have no way for a web page to write to the camera roll, but the share sheet does
 * it: "Save Image" there puts the photo in Photos. Android puts a downloaded image in the gallery
 * by itself, so there a plain download is the save. A computer downloads.
 */
function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  return /Android/i.test(ua) ? 'android' : 'desktop';
}

function canShareFiles(): boolean {
  try {
    return typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

/** The whole file, reporting progress. Retries a throttled (429) answer after a short wait. */
async function fetchWithProgress(url: string, signal: AbortSignal, onPct: (pct: number | null) => void): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal, referrerPolicy: 'no-referrer' });
    if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, 2500 * (attempt + 1))); continue; }
    if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    onPct(total ? 0 : null);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) onPct(Math.min(99, Math.round((got / total) * 100)));
    }
    if (got === 0) throw new Error('empty file');
    return new Blob(chunks as BlobPart[], { type: 'image/jpeg' });
  }
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const LABEL: Record<Platform, { idle: string; done: string; hint: string }> = {
  ios: { idle: 'Save to Photos', done: 'Done ✓', hint: 'Choose “Save Image” to put it in your Photos.' },
  android: { idle: 'Save to phone', done: 'Saved ✓', hint: 'Saved to your Downloads; it shows in your Gallery and Google Photos.' },
  desktop: { idle: 'Download', done: 'Downloaded ✓', hint: 'Saved to your Downloads folder.' },
};

/**
 * The viewer's save button. One tap fetches the full-size photo with a progress bar inside the
 * button, then hands it over: the share sheet on an iPhone, a download everywhere else.
 *
 * iOS only opens the share sheet straight from a tap, and a multi-megabyte fetch can outlast that
 * window. When it does, the button turns to "Ready: tap to save", and the second tap opens the sheet
 * at once because the photo is already in memory.
 */
export function SavePhoto({ item }: { item: GalleryItem }) {
  const [platform, setPlatform] = useState<Platform>('desktop');
  const [share, setShare] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const blobs = useRef(new Map<string, Blob>());
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);
    setShare(p === 'ios' && canShareFiles());
  }, []);

  // A new photo starts fresh; a fetch still running for the old one is dropped.
  useEffect(() => {
    abort.current?.abort();
    setState({ kind: 'idle' });
  }, [item.id]);
  useEffect(() => () => abort.current?.abort(), []);

  const file = (blob: Blob) => new File([blob], item.downloadName, { type: 'image/jpeg' });

  async function hand(blob: Blob): Promise<void> {
    if (share) {
      try {
        await navigator.share({ files: [file(blob)] });
        setState({ kind: 'done' });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        // The tap's permission ran out while downloading: one more tap opens the sheet straight away.
        if (name === 'NotAllowedError') setState({ kind: 'ready' });
        // Closing the sheet without choosing is not an error.
        else if (name === 'AbortError') setState({ kind: 'idle' });
        else setState({ kind: 'error' });
      }
      return;
    }
    downloadBlob(blob, item.downloadName);
    setState({ kind: 'done' });
  }

  async function onTap() {
    if (state.kind === 'loading') return;
    const cached = blobs.current.get(item.id);
    if (cached) { await hand(cached); return; }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState({ kind: 'loading', pct: null });
    try {
      const blob = await fetchWithProgress(item.download, ctrl.signal, (pct) => setState({ kind: 'loading', pct }));
      if (ctrl.signal.aborted) return;
      blobs.current.set(item.id, blob);
      // Keep only the last few in memory; full-size photos are several megabytes each.
      if (blobs.current.size > 3) blobs.current.delete(blobs.current.keys().next().value!);
      await hand(blob);
    } catch (err) {
      if (ctrl.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
      setState({ kind: 'error' });
    }
  }

  // "Done" settles back after a moment so the same photo can be saved again.
  useEffect(() => {
    if (state.kind !== 'done') return;
    const t = setTimeout(() => setState({ kind: 'idle' }), 4000);
    return () => clearTimeout(t);
  }, [state.kind]);

  const label = LABEL[platform];
  const pct = state.kind === 'loading' ? state.pct : null;
  const text =
    state.kind === 'loading' ? (pct === null ? 'Getting photo…' : `Getting photo… ${pct}%`)
    : state.kind === 'ready' ? 'Ready: tap to save'
    : state.kind === 'done' ? label.done
    : state.kind === 'error' ? 'Didn’t work: tap to retry'
    : label.idle;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-none">
      <button
        type="button"
        onClick={() => void onTap()}
        aria-busy={state.kind === 'loading'}
        data-testid="gallery-save"
        data-state={state.kind}
        className={`relative overflow-hidden px-6 py-4 text-sm font-bold uppercase tracking-label transition sm:min-w-[15rem] ${
          state.kind === 'done' ? 'bg-bone text-ink'
          : state.kind === 'error' ? 'bg-red-100 text-red-800'
          : state.kind === 'ready' ? 'animate-pulse bg-orange text-ink'
          : 'bg-orange text-ink hover:bg-orange-bright'
        }`}
      >
        {/* The progress fill grows across the button behind the label. */}
        {state.kind === 'loading' && (
          <span aria-hidden className="absolute inset-y-0 left-0 bg-orange-bright transition-[width] duration-200"
            style={{ width: `${pct ?? 100}%`, opacity: pct === null ? 0.5 : 1 }} />
        )}
        <span className="relative flex items-center justify-center gap-2.5">
          {state.kind === 'loading' && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />}
          {state.kind === 'idle' && <span aria-hidden>↓</span>}
          {text}
        </span>
      </button>
      <p aria-live="polite" className="min-h-[1.25rem] text-xs text-bone/80">
        {state.kind === 'ready' || (state.kind === 'loading' && share) ? LABEL.ios.hint
          : state.kind === 'done' ? label.hint
          : state.kind === 'error' ? 'Check your connection and try again.'
          : ''}
      </p>
    </div>
  );
}

/** The untouched camera file. It is large, so the tap only starts the browser's own download, and says so. */
export function RawLink({ href }: { href: string }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) return;
    const t = setTimeout(() => setStarted(false), 6000);
    return () => clearTimeout(t);
  }, [started]);
  return (
    <div className="flex flex-col gap-1.5">
      <a
        href={href} onClick={() => setStarted(true)} data-testid="gallery-raw" referrerPolicy="no-referrer"
        className="border-hair border-bone/60 px-5 py-4 text-center text-sm font-bold uppercase tracking-label text-bone hover:border-bone"
        title="The original camera file (.ARW), untouched"
      >
        {started ? 'RAW download started ✓' : 'Original RAW'}
      </a>
      <p className="min-h-[1.25rem] text-xs text-bone/80">{started ? 'About 50 MB; your browser shows its progress.' : ''}</p>
    </div>
  );
}


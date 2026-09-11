'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { checkPickedFile } from '@/lib/photos/rules';
import { resizeToSquareJpeg } from '@/lib/photos/resize';
import { TeamAvatar } from './TeamAvatar';
import { ui } from './ui';

/**
 * Lets the form around a PhotoField hear when a resize is in flight, so it can hold its submit
 * until the small JPEG is ready. See PhotoForm and JoinForm.
 */
export const PhotoBusyContext = createContext<((busy: boolean) => void) | null>(null);

/**
 * The team's photo, beside its identity. Everything happens in the browser: the picked file is
 * checked, cropped square and re-encoded to about 80 KB before the form is ever submitted, so the
 * POST carries one small JPEG rather than a phone photo.
 *
 * `photo` carries the path already stored, emptied when the team removes it; `photo_file` carries
 * a new blob. The server takes the file when there is one, the path otherwise.
 *
 * The picker and the submitted file are two inputs. The picker has no name, so the original
 * (often 5–15 MB, far over the server-action body limit) can never be posted, not even if the form
 * is sent mid-resize; `photo_file` is only ever given the resized blob.
 */
export function PhotoField({ teamName, colour, currentPath }: {
  teamName: string; colour: string; currentPath: string | null;
}) {
  const [path, setPath] = useState(currentPath);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const carrier = useRef<HTMLInputElement>(null);
  const reportBusy = useContext(PhotoBusyContext);
  // Bumped whenever the picked file (or its resize) should no longer take effect, so an in-flight
  // resize that's since been cancelled by a Remove (or superseded by a later pick) can tell and
  // discard its result instead of applying it.
  const tokenRef = useRef(0);
  // Mirrors `preview` so the unmount cleanup can revoke it without depending on state.
  const previewRef = useRef<string | null>(null);

  useEffect(() => { reportBusy?.(busy); }, [busy, reportBusy]);
  useEffect(() => () => reportBusy?.(false), [reportBusy]);

  function clearCarrier() {
    if (carrier.current) carrier.current.value = '';
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Emptied straight away so picking the same file again still fires a change.
    e.target.value = '';
    if (!file) return;
    const problem = checkPickedFile(file);
    if (problem) { setError(problem); return; }
    setError(null);
    setBusy(true);
    // A blob from an earlier pick must not go up alongside a preview of this one.
    clearCarrier();
    const token = ++tokenRef.current;
    try {
      const blob = await resizeToSquareJpeg(file);
      if (token !== tokenRef.current) return; // cancelled (removed, or superseded) while resizing
      // DataTransfer is the only way to write a FileList.
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
      if (carrier.current) carrier.current.files = dt.files;
      setPreview((old) => { if (old) URL.revokeObjectURL(old); const next = URL.createObjectURL(blob); previewRef.current = next; return next; });
    } catch (err) {
      if (token !== tokenRef.current) return;
      clearCarrier();
      setError(err instanceof Error ? err.message : 'Could not read that photo');
    } finally {
      if (token === tokenRef.current) setBusy(false);
    }
  }

  function remove() {
    tokenRef.current++; // invalidate any resize still in flight
    clearCarrier();
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return null; });
    previewRef.current = null;
    setPath(null);
    setError(null);
    setBusy(false);
  }

  // Release the preview object URL if the component unmounts while one is showing.
  useEffect(() => {
    return () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); };
  }, []);

  const has = preview !== null || path !== null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {preview
        ? <img src={preview} alt="" style={{ width: 72, height: 72, borderColor: colour }} className="inline-block shrink-0 rounded-full border-[3px] object-cover" />
        : <TeamAvatar teamName={teamName} colour={colour} path={path} size={72} />}
      <input ref={picker} type="file" accept="image/*" className="hidden" onChange={pick} />
      <input ref={carrier} type="file" name="photo_file" className="hidden" tabIndex={-1} aria-hidden />
      <input type="hidden" name="photo" value={path ?? ''} readOnly />
      <button type="button" disabled={busy} onClick={() => picker.current?.click()} className={ui.tiny}>
        {busy ? 'Working…' : has ? 'Change photo' : 'Add photo'}
      </button>
      {has && <button type="button" onClick={remove} className={ui.tiny}>Remove</button>}
      {error && <span role="alert" className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}

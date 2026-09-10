'use client';
import { useEffect, useRef, useState } from 'react';
import { checkPickedFile } from '@/lib/photos/rules';
import { resizeToSquareJpeg } from '@/lib/photos/resize';
import { TeamAvatar } from './TeamAvatar';
import { ui } from './ui';

/**
 * The team's photo, beside its identity. Everything happens in the browser: the picked file is
 * checked, cropped square and re-encoded to about 80 KB before the form is ever submitted, so the
 * POST carries one small JPEG rather than a phone photo.
 *
 * `photo` carries the path already stored, emptied when the team removes it; `photo_file` carries
 * a new blob. The server takes the file when there is one, the path otherwise.
 */
export function PhotoField({ teamName, colour, currentPath }: {
  teamName: string; colour: string; currentPath: string | null;
}) {
  const [path, setPath] = useState(currentPath);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Bumped whenever the picked file (or its resize) should no longer take effect, so an in-flight
  // resize that's since been cancelled by a Remove (or superseded by a later pick) can tell and
  // discard its result instead of applying it.
  const tokenRef = useRef(0);
  // Mirrors `preview` so the unmount cleanup can revoke it without depending on state.
  const previewRef = useRef<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const problem = checkPickedFile(file);
    if (problem) { e.target.value = ''; setError(problem); return; }
    setError(null);
    setBusy(true);
    const token = ++tokenRef.current;
    try {
      const blob = await resizeToSquareJpeg(file);
      if (token !== tokenRef.current) return; // cancelled (removed, or superseded) while resizing
      // The resized blob replaces the picked file in the input, so the form posts ~80 KB rather
      // than the original. DataTransfer is the only way to write a FileList.
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
      if (fileInput.current) fileInput.current.files = dt.files;
      setPreview((old) => { if (old) URL.revokeObjectURL(old); const next = URL.createObjectURL(blob); previewRef.current = next; return next; });
    } catch (err) {
      if (token !== tokenRef.current) return;
      if (fileInput.current) fileInput.current.value = '';
      setError(err instanceof Error ? err.message : 'Could not read that photo');
    } finally {
      if (token === tokenRef.current) setBusy(false);
    }
  }

  function remove() {
    tokenRef.current++; // invalidate any resize still in flight
    if (fileInput.current) fileInput.current.value = '';
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
        ? <img src={preview} alt="" style={{ width: 44, height: 44, borderColor: colour }} className="inline-block shrink-0 rounded-full border-[3px] object-cover" />
        : <TeamAvatar teamName={teamName} colour={colour} path={path} size={44} />}
      <input ref={fileInput} type="file" name="photo_file" accept="image/*" className="hidden" onChange={pick} />
      <input type="hidden" name="photo" value={path ?? ''} readOnly />
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={ui.tiny}>
        {busy ? 'Working…' : has ? 'Change photo' : 'Add photo'}
      </button>
      {has && <button type="button" onClick={remove} className={ui.tiny}>Remove</button>}
      {error && <span role="alert" className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}

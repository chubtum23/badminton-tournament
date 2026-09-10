'use client';
import { useRef, useState } from 'react';
import { checkPickedFile } from '@/lib/photos/rules';
import { resizeToSquareJpeg } from '@/lib/photos/resize';
import { PlayerAvatar } from './PlayerAvatar';
import { ui } from './ui';

/**
 * One player's photo, beside their name box. Everything happens in the browser: the picked file is
 * checked, cropped square and re-encoded to about 80 KB before the form is ever submitted, so the
 * sign-up POST carries three small JPEGs rather than three phone photos.
 *
 * `photo_<role>` carries the path already stored, emptied when the player removes it;
 * `photo_<role>_file` carries a new blob. The server takes the file when there is one, the path
 * otherwise.
 */
export function PhotoField({ role, name, colour, currentPath }: {
  role: 'mixed1' | 'mixed2' | 'woman'; name: string; colour: string; currentPath: string | null;
}) {
  const [path, setPath] = useState(currentPath);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const problem = checkPickedFile(file);
    if (problem) { e.target.value = ''; setError(problem); return; }
    setError(null);
    setBusy(true);
    try {
      const blob = await resizeToSquareJpeg(file);
      // The resized blob replaces the picked file in the input, so the form posts ~80 KB rather
      // than the original. DataTransfer is the only way to write a FileList.
      const dt = new DataTransfer();
      dt.items.add(new File([blob], `${role}.jpg`, { type: 'image/jpeg' }));
      if (fileInput.current) fileInput.current.files = dt.files;
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
    } catch (err) {
      if (fileInput.current) fileInput.current.value = '';
      setError(err instanceof Error ? err.message : 'Could not read that photo');
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (fileInput.current) fileInput.current.value = '';
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return null; });
    setPath(null);
    setError(null);
  }

  const has = preview !== null || path !== null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {preview
        ? <img src={preview} alt="" style={{ width: 44, height: 44, borderColor: colour }} className="inline-block shrink-0 rounded-full border-[3px] object-cover" />
        : <PlayerAvatar name={name} colour={colour} path={path} size={44} />}
      <input ref={fileInput} type="file" name={`photo_${role}_file`} accept="image/*" className="hidden" onChange={pick} />
      <input type="hidden" name={`photo_${role}`} value={path ?? ''} />
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={ui.tiny}>
        {busy ? 'Working…' : has ? 'Change photo' : 'Add photo'}
      </button>
      {has && <button type="button" onClick={remove} className={ui.tiny}>Remove</button>}
      {error && <span role="alert" className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}

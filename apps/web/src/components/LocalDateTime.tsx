'use client';
import { useEffect, useState } from 'react';

/**
 * Deterministic fallback rendered on the server and on the first client render, so the two
 * agree and React does not report a hydration mismatch. Replaced after mount.
 */
function utcFallback(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * An instant shown in the VIEWER's timezone.
 *
 * Formatting on the server would use the server's zone (UTC on most hosts), so an evening
 * start would display as a morning time for everyone. Formatting after mount uses the
 * browser's zone instead.
 */
export function LocalDateTime({ iso }: { iso: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) setText(d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }));
  }, [iso]);
  return <time dateTime={iso}>{text || utcFallback(iso)}</time>;
}

/** An ISO timestamp as the `YYYY-MM-DDTHH:mm` that <input type="datetime-local"> expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A date and time picker that submits a full ISO instant under `name`, computed in the
 * browser. The organiser types their own local clock time; converting it here rather than in
 * the server action is what makes the stored instant correct whatever zone the server runs in.
 * The visible field is named `<name>Local` and is ignored by the server.
 */
export function LocalDateTimeInput({ name, defaultIso = null, className }: {
  name: string; defaultIso?: string | null; className?: string;
}) {
  const [local, setLocal] = useState('');
  useEffect(() => { setLocal(toLocalInput(defaultIso)); }, [defaultIso]);
  const parsed = local === '' ? null : new Date(local);
  const iso = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '';
  return (
    <>
      <input
        type="datetime-local"
        name={`${name}Local`}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className={className}
      />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}

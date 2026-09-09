'use client';
import { useEffect, useState } from 'react';

/** sessionStorage key prefix; one entry per match id. */
export const OUTCOME_PREFIX = 'score-outcome:';
/** A window event ScoreForm fires so an already-mounted banner picks the entry up at once. */
export const OUTCOME_EVENT = 'score-outcome';
/** Entries older than this are stale: a page opened much later must not replay them. */
const MAX_AGE_MS = 15_000;
/** How long an entry stays on screen once it has been picked up. */
const SHOW_MS = 8_000;

interface Entry {
  /** Unique per save, so the same match saved twice shows twice. */
  id: string;
  key: string;
  text: string;
  at: number;
}

/**
 * Reads every fresh outcome out of sessionStorage and removes it as it goes. Consuming on read
 * (rather than at the end of the display timeout) is deliberate: the entry must show once, not
 * again on every later navigation inside the 15-second window.
 */
function drain(): Entry[] {
  const out: Entry[] = [];
  let keys: string[];
  try {
    keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i))
      .filter((k): k is string => k !== null && k.startsWith(OUTCOME_PREFIX));
  } catch {
    return out; // private mode / blocked storage
  }
  for (const key of keys) {
    try {
      const raw = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      const v = JSON.parse(raw ?? 'null') as { text?: unknown; at?: unknown } | null;
      if (!v || typeof v.text !== 'string' || typeof v.at !== 'number') continue;
      if (Date.now() - v.at > MAX_AGE_MS) continue;
      out.push({ id: `${key}#${v.at}`, key, text: v.text, at: v.at });
    } catch {
      /* unreadable entry; skip */
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Stacked banner for results saved a moment ago. The score form writes its outcome to
 * sessionStorage before refreshing the page, because the card holding the inline message often
 * unmounts on that refresh (a saved match drops out of the "open" filter). Mounted once at the
 * top of the page, this replays those messages so the confirmation is never lost.
 */
export function RecentOutcome() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    const pull = () => setEntries((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const fresh = drain().filter((e) => !seen.has(e.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    pull();
    window.addEventListener(OUTCOME_EVENT, pull);
    return () => window.removeEventListener(OUTCOME_EVENT, pull);
  }, []);

  useEffect(() => {
    if (entries.length === 0) return;
    // Deadlines are absolute, so re-arming them whenever the list changes is harmless.
    const timers = entries.map((e) => setTimeout(
      () => setEntries((prev) => prev.filter((x) => x.id !== e.id)),
      Math.max(0, e.at + SHOW_MS - Date.now()),
    ));
    return () => timers.forEach(clearTimeout);
  }, [entries]);

  if (entries.length === 0) return null;
  return (
    <div data-testid="score-outcome-banner" className="space-y-2">
      {entries.map((e) => (
        <p key={e.id} className="border-l-4 border-orange bg-orange-wash px-4 py-3 text-[13px] font-semibold text-orange-ink">{e.text}</p>
      ))}
    </div>
  );
}

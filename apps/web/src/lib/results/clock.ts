/**
 * The countdown a live match runs against, as pure arithmetic over the four stored fields.
 *
 * The end time is derived rather than written per tick, so every viewer agrees on the clock.
 * A stoppage (injury, lost shuttle, a dispute) must not eat into the cap, so `paused_ms` holds
 * the total time already spent stopped and `paused_at` marks a stoppage still in progress.
 */
export interface ClockState {
  /** When the match went to court; null before it ever started. */
  startedAt: string | null;
  /** Set while the clock is stopped; null while it is running. */
  pausedAt: string | null;
  /** Total milliseconds already spent paused, excluding a pause still in progress. */
  pausedMs: number;
  /** The stage's time cap in minutes; null when this stage has no clock. */
  capMinutes: number | null;
}

/**
 * Milliseconds of actual play. While paused the clock is frozen at `pausedAt`, and the
 * accumulated `pausedMs` is always subtracted. Never negative.
 */
export function elapsedMs(c: ClockState, now: number): number {
  if (!c.startedAt) return 0;
  const started = Date.parse(c.startedAt);
  if (Number.isNaN(started)) return 0;
  // A pause in progress freezes the clock at the moment it was stopped.
  const at = c.pausedAt ? Date.parse(c.pausedAt) : now;
  const upTo = Number.isNaN(at) ? now : at;
  return Math.max(0, upTo - started - c.pausedMs);
}

/** Milliseconds left of the cap, floored at zero; null when there is no cap or no start. */
export function remainingMs(c: ClockState, now: number): number | null {
  if (c.capMinutes === null || !c.startedAt) return null;
  return Math.max(0, c.capMinutes * 60_000 - elapsedMs(c, now));
}

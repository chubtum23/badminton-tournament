/** In-memory sliding-window limiter. Single-instance v1; swap for a shared store when scaling out. */
const hits = new Map<string, number[]>();

function recent(key: string, windowMs: number, now: number): number[] {
  const kept = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.set(key, kept);
  return kept;
}

/** Whether the key has already used its budget. Does not consume any. */
export function atLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  return recent(key, windowMs, now).length >= limit;
}

/** Consumes one unit of the key's budget. */
export function record(key: string, windowMs: number, now: number = Date.now()): void {
  recent(key, windowMs, now).push(now);
}

/** Check and consume in one step: true when the caller may proceed. */
export function allow(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  if (atLimit(key, limit, windowMs, now)) return false;
  record(key, windowMs, now);
  return true;
}

export function resetRateLimit(): void {
  hits.clear();
}

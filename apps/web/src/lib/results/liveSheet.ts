import { validStart, type SheetStart, type Side } from './scoresheet';

/**
 * Sharing a score sheet between devices.
 *
 * Each game being scored has one row in `live_games`: the opening server and receiver, the rallies
 * so far, and a revision number. Every tap sends the whole sheet with the revision it was based on;
 * the database accepts it only if nobody else has written since, and otherwise hands back the
 * current sheet. So any organiser can pick up a sheet and carry on, and when two tap at once one of
 * them simply sees the other's tally arrive instead of their own.
 *
 * The scorer's phone keeps its own copy too (see useSharedSheet), so a dropped connection loses
 * nothing: the taps queue up and go when the signal comes back.
 */
export interface Sheet { start: SheetStart; rallies: Side[] }
export interface LiveRow extends Sheet { rev: number }

export const liveKey = (matchId: string, gameNo: number) => `${matchId}:${gameNo}`;

export const encodeRallies = (rallies: readonly Side[]): string => rallies.join('');

export function decodeRallies(raw: unknown): Side[] | null {
  if (typeof raw !== 'string' || !/^[ab]*$/.test(raw)) return null;
  return raw.split('') as Side[];
}

/** A live_games row (or an RPC reply) as a sheet, or null if it is not one. */
export function rowToLive(row: { server?: unknown; receiver?: unknown; rallies?: unknown; rev?: unknown } | null | undefined): LiveRow | null {
  if (!row) return null;
  const start = { server: Number(row.server), receiver: Number(row.receiver) };
  const rallies = decodeRallies(row.rallies);
  const rev = Number(row.rev);
  if (!validStart(start) || !rallies || !Number.isInteger(rev) || rev < 1) return null;
  return { start, rallies, rev };
}

/** The running score of a sheet: every rally is one point to the side that won it. */
export function liveScore(rallies: readonly Side[]): { a: number; b: number } {
  let a = 0;
  for (const r of rallies) if (r === 'a') a++;
  return { a, b: rallies.length - a };
}

export const sameSheet = (x: Sheet, y: Sheet) =>
  x.start.server === y.start.server && x.start.receiver === y.start.receiver && encodeRallies(x.rallies) === encodeRallies(y.rallies);

/** What the scorer's phone remembers between visits. */
export interface Stored extends Sheet {
  /** The server revision the sheet was based on; 0 if it never reached the server. */
  rev: number;
  /** It has taps the server has not accepted yet. */
  dirty: boolean;
}

export interface SyncState {
  sheet: Sheet;
  /** The server revision `sheet` is based on; 0 when there is no row yet. */
  rev: number;
  /** `sheet` has changes the server has not accepted. */
  dirty: boolean;
  /** The snapshot currently on its way to the server. */
  sending: Sheet | null;
  /** The last send failed; the next one waits a moment. */
  offline: boolean;
  /** Another device's tally replaced this one's last tap. */
  takenOver: boolean;
  /** The game has a final score, so the sheet is closed. */
  closed: boolean;
}

export const DEFAULT_START: SheetStart = { server: 0, receiver: 2 };

/**
 * Where a sheet picks up when it opens: the shared sheet, unless this phone has taps it never got
 * to send on top of that same revision. A phone's copy with no server row behind it is only kept
 * if it never reached the server; one that did was closed (the game was saved) and is stale.
 */
export function initialSync(local: Stored | null, server: LiveRow | null): SyncState {
  const base = { sending: null, offline: false, takenOver: false, closed: false };
  if (server) {
    if (local && local.dirty && local.rev === server.rev) {
      return { ...base, sheet: { start: local.start, rallies: local.rallies }, rev: server.rev, dirty: true };
    }
    return { ...base, sheet: { start: server.start, rallies: server.rallies }, rev: server.rev, dirty: false };
  }
  if (local && local.rev === 0 && local.rallies.length > 0) {
    return { ...base, sheet: { start: local.start, rallies: local.rallies }, rev: 0, dirty: true };
  }
  return { ...base, sheet: { start: local?.rev === 0 ? local.start : DEFAULT_START, rallies: [] }, rev: 0, dirty: false };
}

export type PushResult =
  | { kind: 'applied'; row: LiveRow }
  | { kind: 'stale'; row: LiveRow | null }
  | { kind: 'scored' };

/** Reads push_live_game's reply. */
export function parsePush(data: unknown): PushResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.scored === true) return { kind: 'scored' };
  if (d.applied === true) {
    const row = rowToLive(d);
    return row ? { kind: 'applied', row } : null;
  }
  if (d.applied === false) return { kind: 'stale', row: Number(d.rev) === 0 ? null : rowToLive(d) };
  return null;
}

export type SyncAction =
  | { type: 'edit'; sheet: Sheet }
  | { type: 'send'; sheet: Sheet }
  | { type: 'pushed'; result: PushResult }
  | { type: 'failed' }
  | { type: 'remote'; row: LiveRow | null };

export function syncReducer(state: SyncState, action: SyncAction): SyncState {
  switch (action.type) {
    case 'edit':
      if (state.closed) return state;
      return { ...state, sheet: action.sheet, dirty: true, takenOver: false };
    case 'send':
      return { ...state, sending: action.sheet };
    case 'failed':
      return { ...state, sending: null, offline: true };
    case 'pushed': {
      const r = action.result;
      const sent = state.sending;
      if (r.kind === 'scored') return { ...state, sending: null, offline: false, dirty: false, closed: true };
      if (r.kind === 'applied') {
        // Taps made while the send was in flight are still to go.
        return { ...state, rev: r.row.rev, sending: null, offline: false, dirty: sent === null || !sameSheet(state.sheet, sent) };
      }
      // Stale with no row: the sheet was dropped underneath us. Start it again from this tally.
      if (r.row === null) return { ...state, rev: 0, sending: null, offline: false, dirty: true };
      return {
        ...state,
        sheet: { start: r.row.start, rallies: r.row.rallies },
        rev: r.row.rev,
        sending: null,
        offline: false,
        dirty: false,
        takenOver: !sameSheet(state.sheet, r.row),
      };
    }
    case 'remote': {
      const row = action.row;
      // Our own writes echo back at a revision we already have; and while we have taps of our own
      // outstanding, our next send settles it (the server hands back the winner if we lost).
      if (!row || row.rev <= state.rev || state.dirty || state.sending) return state;
      return { ...state, sheet: { start: row.start, rallies: row.rallies }, rev: row.rev, takenOver: false };
    }
  }
}

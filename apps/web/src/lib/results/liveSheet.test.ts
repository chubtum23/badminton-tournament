import { describe, expect, it } from 'vitest';
import { initialSync, liveScore, parsePush, rowToLive, syncReducer, type LiveRow, type SyncState } from './liveSheet';
import type { Side } from './scoresheet';

const start = { server: 0, receiver: 2 };
const r = (s: string) => s.split('') as Side[];
const row = (rallies: string, rev: number): LiveRow => ({ start, rallies: r(rallies), rev });

const synced = (rallies: string, rev: number): SyncState => ({
  sheet: { start, rallies: r(rallies) }, rev, dirty: false, sending: null, offline: false, takenOver: false, closed: false,
});

describe('rowToLive / parsePush', () => {
  it('reads a row and rejects junk', () => {
    expect(rowToLive({ server: 1, receiver: 3, rallies: 'aab', rev: 4 })).toEqual({ start: { server: 1, receiver: 3 }, rallies: ['a', 'a', 'b'], rev: 4 });
    expect(rowToLive({ server: 0, receiver: 1, rallies: 'a', rev: 1 })).toBeNull(); // same side
    expect(rowToLive({ server: 0, receiver: 2, rallies: 'ax', rev: 1 })).toBeNull();
    expect(rowToLive(null)).toBeNull();
  });

  it('reads the three kinds of reply', () => {
    expect(parsePush({ scored: true, applied: false })).toEqual({ kind: 'scored' });
    expect(parsePush({ applied: true, server: 0, receiver: 2, rallies: 'a', rev: 2 })).toEqual({ kind: 'applied', row: row('a', 2) });
    expect(parsePush({ applied: false, rev: 0 })).toEqual({ kind: 'stale', row: null });
    expect(parsePush({ applied: false, server: 0, receiver: 2, rallies: 'bb', rev: 5 })).toEqual({ kind: 'stale', row: row('bb', 5) });
  });

  it('scores a sheet by counting rallies', () => {
    expect(liveScore(r('aabab'))).toEqual({ a: 3, b: 2 });
  });
});

describe('initialSync', () => {
  it('takes the shared sheet over a stale phone copy', () => {
    const s = initialSync({ start, rallies: r('a'), rev: 2, dirty: false }, row('aab', 3));
    expect(s.sheet.rallies).toEqual(r('aab'));
    expect(s.dirty).toBe(false);
  });

  it('keeps unsent taps made on top of the current revision', () => {
    const s = initialSync({ start, rallies: r('aaba'), rev: 3, dirty: true }, row('aab', 3));
    expect(s.sheet.rallies).toEqual(r('aaba'));
    expect(s.dirty).toBe(true);
  });

  it('drops unsent taps if someone else has moved on since', () => {
    const s = initialSync({ start, rallies: r('aaba'), rev: 3, dirty: true }, row('aabb', 4));
    expect(s.sheet.rallies).toEqual(r('aabb'));
    expect(s.dirty).toBe(false);
  });

  it('sends a sheet that never reached the server', () => {
    const s = initialSync({ start, rallies: r('ab'), rev: 0, dirty: true }, null);
    expect(s.sheet.rallies).toEqual(r('ab'));
    expect(s.dirty).toBe(true);
  });

  it('forgets a copy whose shared sheet has closed', () => {
    const s = initialSync({ start, rallies: r('ab'), rev: 7, dirty: false }, null);
    expect(s.sheet.rallies).toEqual([]);
    expect(s.dirty).toBe(false);
  });
});

describe('syncReducer', () => {
  it('a tap is sent and accepted', () => {
    let s = syncReducer(synced('a', 1), { type: 'edit', sheet: { start, rallies: r('ab') } });
    expect(s.dirty).toBe(true);
    s = syncReducer(s, { type: 'send', sheet: s.sheet });
    s = syncReducer(s, { type: 'pushed', result: { kind: 'applied', row: row('ab', 2) } });
    expect(s).toMatchObject({ rev: 2, dirty: false, sending: null });
  });

  it('a tap made while a send is in flight is still to go', () => {
    let s = syncReducer(synced('a', 1), { type: 'edit', sheet: { start, rallies: r('ab') } });
    s = syncReducer(s, { type: 'send', sheet: s.sheet });
    s = syncReducer(s, { type: 'edit', sheet: { start, rallies: r('abb') } });
    s = syncReducer(s, { type: 'pushed', result: { kind: 'applied', row: row('ab', 2) } });
    expect(s).toMatchObject({ rev: 2, dirty: true });
    expect(s.sheet.rallies).toEqual(r('abb'));
  });

  it('losing a race adopts the other device\'s sheet', () => {
    let s = syncReducer(synced('a', 1), { type: 'edit', sheet: { start, rallies: r('ab') } });
    s = syncReducer(s, { type: 'send', sheet: s.sheet });
    s = syncReducer(s, { type: 'pushed', result: { kind: 'stale', row: row('aa', 2) } });
    expect(s.sheet.rallies).toEqual(r('aa'));
    expect(s).toMatchObject({ rev: 2, dirty: false, takenOver: true });
  });

  it('a dropped sheet is started again from this tally', () => {
    let s = syncReducer(synced('a', 4), { type: 'edit', sheet: { start, rallies: r('ab') } });
    s = syncReducer(s, { type: 'send', sheet: s.sheet });
    s = syncReducer(s, { type: 'pushed', result: { kind: 'stale', row: null } });
    expect(s).toMatchObject({ rev: 0, dirty: true });
    expect(s.sheet.rallies).toEqual(r('ab'));
  });

  it('a failed send keeps the taps for the retry', () => {
    let s = syncReducer(synced('a', 1), { type: 'edit', sheet: { start, rallies: r('ab') } });
    s = syncReducer(s, { type: 'send', sheet: s.sheet });
    s = syncReducer(s, { type: 'failed' });
    expect(s).toMatchObject({ dirty: true, offline: true, sending: null });
  });

  it('follows another device\'s taps, but not its own echo', () => {
    let s = syncReducer(synced('a', 2), { type: 'remote', row: row('a', 2) });
    expect(s.rev).toBe(2);
    s = syncReducer(s, { type: 'remote', row: row('ab', 3) });
    expect(s.sheet.rallies).toEqual(r('ab'));
    expect(s.rev).toBe(3);
  });

  it('ignores remote sheets while its own taps are outstanding', () => {
    const s0 = syncReducer(synced('a', 2), { type: 'edit', sheet: { start, rallies: r('aa') } });
    const s = syncReducer(s0, { type: 'remote', row: row('ab', 3) });
    expect(s.sheet.rallies).toEqual(r('aa'));
  });

  it('closes once the game is scored', () => {
    const s0 = synced('a', 1);
    let s = syncReducer(s0, { type: 'send', sheet: s0.sheet });
    s = syncReducer(s, { type: 'pushed', result: { kind: 'scored' } });
    expect(s.closed).toBe(true);
    expect(syncReducer(s, { type: 'edit', sheet: { start, rallies: r('ab') } }).sheet.rallies).toEqual(r('a'));
  });
});

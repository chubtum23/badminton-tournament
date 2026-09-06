import { describe, it, expect } from 'vitest';
import { advance, rollback } from './advance';
import { makeMatch } from './testUtils';

const ko = (over: Parameters<typeof makeMatch>[0]) => makeMatch({ stage: 'knockout', ...over });

describe('advance', () => {
  const semi1 = ko({ id: 's1', round: 1, slot: 1, teamAId: 'A1', teamBId: 'B2', status: 'live', court: 2, nextMatchId: 'f', nextMatchSide: 'a' });
  const semi2 = ko({ id: 's2', round: 1, slot: 2, teamAId: 'B1', teamBId: 'A2', status: 'ready', nextMatchId: 'f', nextMatchSide: 'b' });
  const final = ko({ id: 'f', round: 2, slot: 1 });

  it('marks the match done, clears the court and fills the next match side', () => {
    const changed = advance([semi1, semi2, final], 's1', 'B2');
    expect(changed).toHaveLength(2);
    expect(changed[0]).toMatchObject({ id: 's1', status: 'done', winnerId: 'B2', court: null });
    expect(changed[1]).toMatchObject({ id: 'f', teamAId: 'B2', teamBId: null, status: 'pending' });
  });

  it('advance does not mutate the inputs', () => {
    advance([semi1, semi2, final], 's1', 'B2');
    expect(semi1.status).toBe('live');
    expect(final.teamAId).toBeNull();
  });

  it('makes the next match ready once both sides are known', () => {
    const halfFilled = { ...final, teamAId: 'B2' };
    const changed = advance([semi1, semi2, halfFilled], 's2', 'A2');
    expect(changed[1]).toMatchObject({ id: 'f', teamAId: 'B2', teamBId: 'A2', status: 'ready' });
  });

  it('returns only the match itself for the final', () => {
    const readyFinal = { ...final, teamAId: 'B2', teamBId: 'A2', status: 'ready' as const };
    const changed = advance([readyFinal], 'f', 'A2');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ id: 'f', status: 'done', winnerId: 'A2' });
  });

  it('rejects a winner who is not in the match', () => {
    expect(() => advance([semi1, semi2, final], 's1', 'C1')).toThrow('winner is not in this match');
  });

  it('rejects an unknown match', () => {
    expect(() => advance([semi1], 'nope', 'A1')).toThrow('unknown match nope');
  });

  it('rejects re-entering a different winner on a done match', () => {
    const done = ko({ id: 'd1', teamAId: 'A1', teamBId: 'B2', status: 'done', winnerId: 'A1' });
    expect(() => advance([done], 'd1', 'B2')).toThrow(
      'match is already done; roll it back before re-entering a different winner',
    );
  });

  it('allows re-entering the same winner on a done match', () => {
    const done = ko({ id: 'd1', teamAId: 'A1', teamBId: 'B2', status: 'done', winnerId: 'A1' });
    const changed = advance([done], 'd1', 'A1');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ id: 'd1', status: 'done', winnerId: 'A1' });
  });

  it('rejects a next match with no next match side', () => {
    const dangling = ko({ id: 'd2', teamAId: 'A1', teamBId: 'B2', status: 'live', nextMatchId: 'f', nextMatchSide: null });
    expect(() => advance([dangling, final], 'd2', 'A1')).toThrow('match has a next match but no next match side');
  });
});

describe('rollback', () => {
  // Round 1: q1, q2 feed semi s1; q3, q4 feed semi s2; semis feed final f.
  const q1 = ko({ id: 'q1', round: 1, slot: 1, teamAId: 'A1', teamBId: 'D2', status: 'done', winnerId: 'A1', nextMatchId: 's1', nextMatchSide: 'a' });
  const q2 = ko({ id: 'q2', round: 1, slot: 2, teamAId: 'D1', teamBId: 'A2', status: 'done', winnerId: 'D1', nextMatchId: 's1', nextMatchSide: 'b' });
  const q3 = ko({ id: 'q3', round: 1, slot: 3, teamAId: 'B1', teamBId: 'C2', status: 'done', winnerId: 'B1', nextMatchId: 's2', nextMatchSide: 'a' });
  const q4 = ko({ id: 'q4', round: 1, slot: 4, teamAId: 'C1', teamBId: 'B2', status: 'ready', nextMatchId: 's2', nextMatchSide: 'b' });
  const s1 = ko({ id: 's1', round: 2, slot: 1, teamAId: 'A1', teamBId: 'D1', status: 'done', winnerId: 'A1', nextMatchId: 'f', nextMatchSide: 'a' });
  const s2 = ko({ id: 's2', round: 2, slot: 2, teamAId: 'B1', teamBId: null, status: 'pending', nextMatchId: 'f', nextMatchSide: 'b' });
  const f = ko({ id: 'f', round: 3, slot: 1, teamAId: 'A1', teamBId: null, status: 'pending' });
  const all = [q1, q2, q3, q4, s1, s2, f];

  it('clears the winner from a ready next match without flagging a reset', () => {
    const { changed, resetMatchIds } = rollback(all, 'q3');
    expect(resetMatchIds).toEqual([]);
    expect(changed).toHaveLength(2);
    expect(changed[0]).toMatchObject({ id: 's2', teamAId: null, teamBId: null, status: 'pending', winnerId: null });
    expect(changed[1]).toMatchObject({
      id: 'q3', status: 'ready', winnerId: null, court: null, teamAId: 'B1', teamBId: 'C2',
    });
  });

  it('cascades through a done semi into the final and flags the semi for reset', () => {
    const { changed, resetMatchIds } = rollback(all, 'q1');
    expect(resetMatchIds).toEqual(['s1']);
    const byId = new Map(changed.map((m) => [m.id, m]));
    expect(byId.get('s1')).toMatchObject({ teamAId: null, teamBId: 'D1', status: 'pending', winnerId: null });
    expect(byId.get('f')).toMatchObject({ teamAId: null, teamBId: null, status: 'pending', winnerId: null });
    expect(byId.get('q1')).toMatchObject({ status: 'ready', winnerId: null, teamAId: 'A1', teamBId: 'D2' });
    expect(changed).toHaveLength(3);
  });

  it('flags a live downstream match for reset and clears its court', () => {
    const liveFinal = { ...f, teamBId: 'B1', status: 'live' as const, court: 1 };
    const { changed, resetMatchIds } = rollback([...all.filter((m) => m.id !== 'f'), liveFinal], 's1');
    expect(resetMatchIds).toEqual(['f']);
    expect(changed[0]).toMatchObject({ id: 'f', teamAId: null, teamBId: 'B1', court: null, status: 'pending' });
    expect(changed[changed.length - 1]).toMatchObject({ id: 's1', status: 'ready', winnerId: null });
  });

  it('does nothing for a match without a winner, and only resets the match itself when it has no next match', () => {
    expect(rollback(all, 'q4')).toEqual({ changed: [], resetMatchIds: [] });
    const doneFinal = { ...f, teamBId: 'B1', status: 'done' as const, winnerId: 'A1' };
    const { changed, resetMatchIds } = rollback([doneFinal], 'f');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ status: 'ready', winnerId: null });
    expect(resetMatchIds).toEqual([]);
  });

  it('resets a bye (one team) to pending rather than ready', () => {
    const bye = ko({
      id: 'bye', round: 1, slot: 1, teamAId: 'A1', teamBId: null, status: 'done', winnerId: 'A1',
      nextMatchId: 's', nextMatchSide: 'a',
    });
    const s = ko({ id: 's', round: 2, slot: 1, teamAId: 'A1', teamBId: null, status: 'pending' });
    const { changed } = rollback([bye, s], 'bye');
    const byId = new Map(changed.map((m) => [m.id, m]));
    expect(byId.get('s')).toMatchObject({ teamAId: null });
    expect(byId.get('bye')).toMatchObject({ status: 'pending', winnerId: null });
  });

  it('composes with advance to re-enter a different winner', () => {
    const { changed } = rollback(all, 'q1');
    const changedMap = new Map(changed.map((m) => [m.id, m]));
    const updated = all.map((m) => changedMap.get(m.id) ?? m);
    expect(() => advance(updated, 'q1', 'D2')).not.toThrow();
    const advanced = new Map(advance(updated, 'q1', 'D2').map((m) => [m.id, m]));
    expect(advanced.get('q1')).toMatchObject({ status: 'done', winnerId: 'D2' });
    expect(advanced.get('s1')).toMatchObject({ teamAId: 'D2' });
  });

  it('rollback does not mutate the inputs', () => {
    rollback(all, 'q1');
    expect(s1.teamAId).toBe('A1');
    expect(f.teamAId).toBe('A1');
  });
});

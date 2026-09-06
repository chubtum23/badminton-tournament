import { describe, it, expect } from 'vitest';
import { advance } from './advance';
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

  it('does not mutate the inputs', () => {
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
});

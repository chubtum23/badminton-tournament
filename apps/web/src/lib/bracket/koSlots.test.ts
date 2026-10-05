import { describe, expect, it } from 'vitest';
import { koSlotChanges } from './koSlots';

const rows = [{ id: 'p1', stage: 'pool' as const }, { id: 'k1', stage: 'knockout' as const }, { id: 'k2', stage: 'knockout' as const }];

describe('koSlotChanges', () => {
  it('adds the missing knockout slots and never touches pool matches', () => {
    const games = [1, 2, 3].flatMap((n) => [{ match_id: 'p1', game_no: n }, { match_id: 'k1', game_no: n }]);
    const out = koSlotChanges(rows, games, 5);
    expect(out.matchIds).toEqual(['k1', 'k2']);
    expect(out.insert).toEqual([
      { match_id: 'k1', game_no: 4 }, { match_id: 'k1', game_no: 5 },
      ...[1, 2, 3, 4, 5].map((n) => ({ match_id: 'k2', game_no: n })),
    ]);
  });

  it('adds nothing when the knockout already has enough slots', () => {
    const games = [1, 2, 3].flatMap((n) => [{ match_id: 'k1', game_no: n }, { match_id: 'k2', game_no: n }]);
    expect(koSlotChanges(rows, games, 1).insert).toEqual([]);
  });
});

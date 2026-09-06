import { describe, it, expect } from 'vitest';
import { bracketSize, bracketOrder, seedQualifiers, buildBracket, type PoolResult } from './bracket';
import { idGen } from './testUtils';
import type { Match } from './types';

const pool = (name: string, n: number): PoolResult => ({
  poolId: name,
  ranked: Array.from({ length: n }, (_, i) => `${name}${i + 1}`),
});
const poolOf = (teamId: string) => teamId[0]!;
const round = (ms: Match[], r: number) => ms.filter((m) => m.round === r).sort((x, y) => x.slot - y.slot);

describe('bracketSize', () => {
  it('rounds up to a power of two, minimum 2', () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(3)).toBe(4);
    expect(bracketSize(4)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(8)).toBe(8);
    expect(bracketSize(9)).toBe(16);
  });
});

describe('bracketOrder', () => {
  it('produces the standard seeding layout', () => {
    expect(bracketOrder(2)).toEqual([1, 2]);
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it('rejects non powers of two', () => {
    expect(() => bracketOrder(6)).toThrow('size must be a power of two');
  });
});

describe('seedQualifiers', () => {
  it('puts every pool winner ahead of every runner-up', () => {
    const seeds = seedQualifiers([pool('A', 4), pool('B', 4), pool('C', 4), pool('D', 4)], 2);
    expect(seeds.slice(0, 4).sort()).toEqual(['A1', 'B1', 'C1', 'D1']);
    expect(seeds.slice(4).sort()).toEqual(['A2', 'B2', 'C2', 'D2']);
  });
  it('throws when a pool is too small', () => {
    expect(() => seedQualifiers([pool('A', 1), pool('B', 2)], 2)).toThrow('pool A has fewer than 2 teams');
  });
});

describe('buildBracket', () => {
  it('two pools, top two: A1 v B2 and B1 v A2 into a final', () => {
    const ms = buildBracket([pool('A', 3), pool('B', 3)], 2, idGen());
    expect(ms).toHaveLength(3);
    const [r1a, r1b] = round(ms, 1);
    const [final] = round(ms, 2);
    expect(r1a).toMatchObject({ teamAId: 'A1', teamBId: 'B2', status: 'ready', nextMatchId: final!.id, nextMatchSide: 'a' });
    expect(r1b).toMatchObject({ teamAId: 'B1', teamBId: 'A2', status: 'ready', nextMatchId: final!.id, nextMatchSide: 'b' });
    expect(final).toMatchObject({ teamAId: null, teamBId: null, status: 'pending', nextMatchId: null, nextMatchSide: null });
  });

  it('four pools, top two: no same-pool clash in round one and A1, B1 in opposite halves', () => {
    const ms = buildBracket([pool('A', 4), pool('B', 4), pool('C', 4), pool('D', 4)], 2, idGen());
    expect(ms).toHaveLength(7);
    const r1 = round(ms, 1);
    expect(r1).toHaveLength(4);
    for (const m of r1) {
      expect(m.status).toBe('ready');
      expect(poolOf(m.teamAId!)).not.toBe(poolOf(m.teamBId!));
    }
    expect(r1.map((m) => [m.teamAId, m.teamBId])).toEqual([
      ['A1', 'D2'], ['D1', 'A2'], ['B1', 'C2'], ['C1', 'B2'],
    ]);
    const semis = round(ms, 2);
    expect(r1[0]!.nextMatchId).toBe(semis[0]!.id);
    expect(r1[1]!.nextMatchId).toBe(semis[0]!.id);
    expect(r1[2]!.nextMatchId).toBe(semis[1]!.id);
    expect(r1[3]!.nextMatchId).toBe(semis[1]!.id);
    expect(semis.every((m) => m.status === 'pending')).toBe(true);
    expect(round(ms, 3)).toHaveLength(1);
  });

  it('three pools, top two: pool winners A1 and B1 get byes and are placed into the semis', () => {
    const ms = buildBracket([pool('A', 3), pool('B', 3), pool('C', 3)], 2, idGen());
    expect(ms).toHaveLength(7);
    const r1 = round(ms, 1);
    const byes = r1.filter((m) => m.status === 'done');
    expect(byes.map((m) => m.winnerId).sort()).toEqual(['A1', 'B1']);
    for (const m of byes) expect(m.teamAId === null || m.teamBId === null).toBe(true);
    const played = r1.filter((m) => m.status === 'ready');
    expect(played).toHaveLength(2);
    for (const m of played) expect(poolOf(m.teamAId!)).not.toBe(poolOf(m.teamBId!));
    const semis = round(ms, 2);
    const semiTeams = semis.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean).sort();
    expect(semiTeams).toEqual(['A1', 'B1']);
    expect(semis.every((m) => m.status === 'pending')).toBe(true);
  });

  it('two pools, winners only: a single ready final', () => {
    const ms = buildBracket([pool('A', 3), pool('B', 3)], 1, idGen());
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ round: 1, slot: 1, teamAId: 'A1', teamBId: 'B1', status: 'ready', nextMatchId: null });
  });

  it('marks a second-round match ready when both of its feeders are byes', () => {
    // 5 qualifiers into 8: seeds 6,7,8 are byes. Positions 2v7 and 3v6 are both byes => semi 2 is ready.
    const ms = buildBracket([pool('A', 3), pool('B', 3), pool('C', 3), pool('D', 3), pool('E', 3)], 1, idGen());
    const semis = round(ms, 2);
    expect(semis.filter((m) => m.status === 'ready')).toHaveLength(1);
  });

  it('every non-final match links to a match in the next round', () => {
    const ms = buildBracket([pool('A', 4), pool('B', 4), pool('C', 4), pool('D', 4)], 2, idGen());
    const byId = new Map(ms.map((m) => [m.id, m]));
    for (const m of ms) {
      if (m.round === 3) { expect(m.nextMatchId).toBeNull(); continue; }
      const next = byId.get(m.nextMatchId!)!;
      expect(next.round).toBe(m.round! + 1);
      expect(next.slot).toBe(Math.ceil(m.slot / 2));
      expect(m.nextMatchSide).toBe(m.slot % 2 === 1 ? 'a' : 'b');
    }
  });
});

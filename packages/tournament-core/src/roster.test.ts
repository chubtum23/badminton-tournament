import { describe, it, expect } from 'vitest';
import { pairFor, pairSlotForGame, validateRoster, type RosterPlayer } from './roster';

const alex: RosterPlayer = { id: 'p1', name: 'Alex', gender: 'male', role: 'mixed1' };
const ben: RosterPlayer = { id: 'p2', name: 'Ben', gender: 'male', role: 'mixed2' };
const priya: RosterPlayer = { id: 'p3', name: 'Priya', gender: 'female', role: 'woman' };
const full = [alex, ben, priya];

describe('validateRoster', () => {
  it('accepts two men and one woman with distinct roles', () => {
    expect(validateRoster(full)).toEqual({ ok: true });
  });
  it('rejects fewer than three players', () => {
    expect(validateRoster([alex, priya])).toEqual({ ok: false, reason: 'a team needs exactly 3 players' });
  });
  it('rejects four players', () => {
    expect(validateRoster([...full, { id: 'p4', name: 'Dee', gender: 'female', role: null }]))
      .toEqual({ ok: false, reason: 'a team needs exactly 3 players' });
  });
  it('rejects a missing role', () => {
    expect(validateRoster([alex, { ...ben, role: null }, priya])).toEqual({ ok: false, reason: 'every player needs a role' });
  });
  it('rejects a duplicated role', () => {
    expect(validateRoster([alex, { ...ben, role: 'mixed1' }, priya])).toEqual({ ok: false, reason: 'roles mixed1, mixed2 and woman must each appear once' });
  });
  it('rejects a woman in a mixed slot', () => {
    expect(validateRoster([alex, { ...ben, gender: 'female' }, priya])).toEqual({ ok: false, reason: 'the two mixed players must be men' });
  });
  it('rejects a man in the woman slot', () => {
    expect(validateRoster([alex, ben, { ...priya, gender: 'male' }])).toEqual({ ok: false, reason: 'the woman slot must be a woman' });
  });
});

describe('pairFor', () => {
  it('mixed1 is the mixed1 man with the woman', () => expect(pairFor(full, 'mixed1')).toEqual([alex, priya]));
  it('mixed2 is the mixed2 man with the woman', () => expect(pairFor(full, 'mixed2')).toEqual([ben, priya]));
  it('mens is the two men, mixed1 first', () => expect(pairFor(full, 'mens')).toEqual([alex, ben]));
  it('is null for an incomplete roster', () => expect(pairFor([alex, priya], 'mens')).toBeNull());
  it('is null when roles are missing even with three players', () => expect(pairFor([alex, { ...ben, role: null }, priya], 'mixed2')).toBeNull());
});

describe('pairSlotForGame', () => {
  it('maps games 1, 2, 3 to mixed1, mixed2, mens', () => {
    expect([1, 2, 3].map(pairSlotForGame)).toEqual(['mixed1', 'mixed2', 'mens']);
  });
  it('sends any later game to the men', () => {
    expect(pairSlotForGame(4)).toBe('mens');
    expect(pairSlotForGame(9)).toBe('mens');
  });
});

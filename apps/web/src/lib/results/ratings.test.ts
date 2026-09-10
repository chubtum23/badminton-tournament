import { describe, it, expect } from 'vitest';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { parseRatings, ratingSlots, RATING_FIELD_PREFIX, type RatingSlot } from './ratings';

function team(id: string, name: string): TeamWithPlayers {
  return {
    id, tournament_id: 't', name, tagline: '', colour: '#2563eb', description: '', seed: null,
    pool_id: null, pool_order: 0, withdrawn: false, pool_rank_override: null,
    players: [
      { id: `${id}-m1`, tournament_id: 't', name: `${name} One`, gender: 'male', photo_path: null, role: 'mixed1' },
      { id: `${id}-m2`, tournament_id: 't', name: `${name} Two`, gender: 'male', photo_path: null, role: 'mixed2' },
      { id: `${id}-w`, tournament_id: 't', name: `${name} Ella`, gender: 'female', photo_path: null, role: 'woman' },
    ],
  };
}

const A = team('a', 'Alpha');
const B = team('b', 'Bravo');

describe('ratingSlots', () => {
  it('gives the Mixed #1 man and the woman for game 1', () => {
    expect(ratingSlots(A, B, 1).map((s) => s.playerId)).toEqual(['a-m1', 'a-w', 'b-m1', 'b-w']);
  });

  it('gives the Mixed #2 man and the woman for game 2', () => {
    expect(ratingSlots(A, B, 2).map((s) => s.playerId)).toEqual(['a-m2', 'a-w', 'b-m2', 'b-w']);
  });

  it('gives the two men for game 3', () => {
    expect(ratingSlots(A, B, 3).map((s) => s.playerId)).toEqual(['a-m1', 'a-m2', 'b-m1', 'b-m2']);
  });

  it('marks which side each player is on', () => {
    expect(ratingSlots(A, B, 1).map((s) => s.side)).toEqual(['a', 'a', 'b', 'b']);
  });

  it('leaves out a team whose roster is incomplete', () => {
    const broken = { ...A, players: A.players.slice(0, 2) };
    expect(ratingSlots(broken, B, 1).map((s) => s.playerId)).toEqual(['b-m1', 'b-w']);
  });

  it('returns nothing when neither team is known', () => {
    expect(ratingSlots(undefined, undefined, 1)).toEqual([]);
  });
});

const SLOTS: RatingSlot[] = ratingSlots(A, B, 1);
const form = (values: Record<string, string>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(`${RATING_FIELD_PREFIX}${k}`, v);
  return fd;
};

describe('parseRatings', () => {
  it('reads one rating per slot', () => {
    const r = parseRatings(form({ 'a-m1': '7.4', 'a-w': '6', 'b-m1': '5.5', 'b-w': '5' }), SLOTS);
    expect(r).toEqual({ ok: true, value: [
      { playerId: 'a-m1', rating: 7.4 }, { playerId: 'a-w', rating: 6 },
      { playerId: 'b-m1', rating: 5.5 }, { playerId: 'b-w', rating: 5 },
    ] });
  });

  it('treats a blank box as no rating for that player', () => {
    const r = parseRatings(form({ 'a-m1': '7.4', 'a-w': '  ', 'b-m1': '', 'b-w': '5' }), SLOTS);
    expect(r.ok && r.value.map((v) => v.playerId)).toEqual(['a-m1', 'b-w']);
  });

  it('accepts a form with no rating boxes at all', () => {
    expect(parseRatings(new FormData(), SLOTS)).toEqual({ ok: true, value: [] });
  });

  it('rejects a rating below the scale', () => {
    expect(parseRatings(form({ 'a-m1': '0' }), SLOTS)).toEqual({ ok: false, reason: 'Alpha One: a rating must be between 1 and 10' });
  });

  it('rejects a rating above the scale', () => {
    expect(parseRatings(form({ 'a-m1': '10.5' }), SLOTS)).toEqual({ ok: false, reason: 'Alpha One: a rating must be between 1 and 10' });
  });

  it('rejects more than one decimal place', () => {
    expect(parseRatings(form({ 'a-m1': '7.25' }), SLOTS)).toEqual({ ok: false, reason: 'Alpha One: a rating takes at most one decimal place' });
  });

  it('rejects something that is not a number', () => {
    expect(parseRatings(form({ 'a-m1': 'good' }), SLOTS)).toEqual({ ok: false, reason: 'Alpha One: a rating must be a number' });
  });

  it('ignores a field for a player who is not on court', () => {
    const fd = form({ 'a-m1': '7' });
    fd.set(`${RATING_FIELD_PREFIX}a-m2`, '10'); // plays game 3, not game 1
    const r = parseRatings(fd, SLOTS);
    expect(r.ok && r.value).toEqual([{ playerId: 'a-m1', rating: 7 }]);
  });
});

import { pairFor, pairSlotForGame } from '@tournament/core';
import type { RosterPlayerRow, TeamRow } from '@/lib/db/types';
import { rosterOf } from '@/lib/teams/roster';

/** One box on the score form: the player it belongs to and the side they are playing for. */
export interface RatingSlot {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  side: 'a' | 'b';
}

/**
 * Looser than `TeamWithPlayers` on purpose: the schedule screens type their teams as
 * `TeamMaybeRoster`, whose roster is only present on the pages that loaded it. A team without one
 * simply yields no boxes.
 */
export type RatableTeam = Pick<TeamRow, 'id' | 'name'> & { players?: RosterPlayerRow[] };

/** Rating inputs are named `rating:<playerId>`, so the four boxes need no index of their own. */
export const RATING_FIELD_PREFIX = 'rating:';

function slotsForSide(team: RatableTeam | undefined, gameNo: number, side: 'a' | 'b'): RatingSlot[] {
  if (!team?.players) return [];
  // A team with an incomplete roster yields no pair, so it simply contributes no boxes: the
  // organiser can still score the game, and the other side is still rated.
  const pair = pairFor(rosterOf({ players: team.players }), pairSlotForGame(gameNo));
  if (!pair) return [];
  return pair.map((p) => ({ playerId: p.id, name: p.name, teamId: team.id, teamName: team.name, side }));
}

/**
 * The four players on court for one game, side A first. Nobody enters a line-up: a team is two men
 * and one woman with fixed roles, so the game number decides the pair.
 */
export function ratingSlots(
  teamA: RatableTeam | undefined,
  teamB: RatableTeam | undefined,
  gameNo: number,
): RatingSlot[] {
  return [...slotsForSide(teamA, gameNo, 'a'), ...slotsForSide(teamB, gameNo, 'b')];
}

/**
 * Reads the rating boxes out of a submitted score form.
 *
 * Only the slots passed in are read, so a field naming someone who is not on court is ignored
 * rather than trusted. A blank box is how the organiser skips a player, and is not an error.
 */
export function parseRatings(
  fd: FormData,
  slots: readonly RatingSlot[],
): { ok: true; value: { playerId: string; rating: number }[] } | { ok: false; reason: string } {
  const value: { playerId: string; rating: number }[] = [];
  for (const slot of slots) {
    const raw = String(fd.get(`${RATING_FIELD_PREFIX}${slot.playerId}`) ?? '').trim();
    if (raw === '') continue;
    if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, reason: `${slot.name}: a rating must be a number` };
    if (!/^\d+(\.\d)?$/.test(raw)) return { ok: false, reason: `${slot.name}: a rating takes at most one decimal place` };
    const rating = Number(raw);
    if (rating < 1 || rating > 10) return { ok: false, reason: `${slot.name}: a rating must be between 1 and 10` };
    value.push({ playerId: slot.playerId, rating });
  }
  return { ok: true, value };
}

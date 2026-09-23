import { bracketOrder, bracketSize, seedQualifiers, type PoolResult } from '@tournament/core';

/**
 * The knockout draw: which qualifier sits in each seed's place.
 *
 * `seats[i]` is the team in seed i+1's place and null is a bye, which is exactly what
 * buildBracketFromSeats consumes. The seeded draw is the default; the organiser can randomise it
 * or move teams by hand, and what they arrange is stored on the tournament until the knockout is
 * started. None of it touches a pool result — the draw only decides bracket places.
 */
export type Seats = (string | null)[];

/** The seeded draw, padded with byes to the bracket's size. */
export function seededSeats(qualifiers: readonly PoolResult[], advancePerPool: number): Seats {
  const seeds = seedQualifiers(qualifiers, advancePerPool);
  const size = bracketSize(seeds.length);
  return Array.from({ length: size }, (_, i) => seeds[i] ?? null);
}

/** A pure shuffle of the qualifiers across the bracket's places, byes included. */
export function randomSeats(teamIds: readonly string[], random: () => number = Math.random): Seats {
  const size = bracketSize(teamIds.length);
  const seats: Seats = Array.from({ length: size }, (_, i) => teamIds[i] ?? null);
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [seats[i], seats[j]] = [seats[j]!, seats[i]!];
  }
  return seats;
}

/**
 * A stored draw is only usable while it still holds exactly the teams that qualified. Pool results
 * can move after a draw is arranged — a corrected score, a playoff, a manual order — and a draw
 * naming a team that no longer qualifies would quietly put the wrong side in the bracket.
 */
export function seatsMatch(seats: readonly (string | null)[] | null | undefined, teamIds: readonly string[]): boolean {
  if (!seats) return false;
  if (seats.length !== bracketSize(teamIds.length)) return false;
  const seated = seats.filter((s): s is string => s !== null);
  if (seated.length !== teamIds.length || new Set(seated).size !== seated.length) return false;
  const want = new Set(teamIds);
  return seated.every((id) => want.has(id));
}

/** Moving a team to a place swaps it with whatever is already there, so a draw stays a draw. */
export function swapSeats(seats: readonly (string | null)[], index: number, teamId: string | null): Seats {
  const next = [...seats];
  if (index < 0 || index >= next.length) return next;
  const from = next.findIndex((s, i) => i !== index && s === teamId && s !== null);
  const displaced = next[index] ?? null;
  next[index] = teamId;
  if (teamId === null) {
    // A bye was asked for here: the team that was here takes the first bye place instead.
    const bye = next.findIndex((s, i) => i !== index && s === null);
    if (bye !== -1) next[bye] = displaced;
    else next[index] = displaced; // no bye to give: nothing to swap with
  } else if (from !== -1) {
    next[from] = displaced;
  }
  return next;
}

/** The first-round pairs of a draw, in bracket order: [[seatIndexA, seatIndexB], ...]. */
export function firstRoundPairs(seats: readonly (string | null)[]): [number, number][] {
  const order = bracketOrder(bracketSize(seats.length));
  const pairs: [number, number][] = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([order[i]! - 1, order[i + 1]! - 1]);
  return pairs;
}

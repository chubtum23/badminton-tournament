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

const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/**
 * A random draw. Byes go into different first-round pairs, each opposite a team: two byes drawn
 * against each other would leave an empty match that never finishes, and the round after it stuck.
 * There are always fewer byes than pairs, so this is always possible.
 */
export function randomSeats(teamIds: readonly string[], random: () => number = Math.random): Seats {
  const size = bracketSize(teamIds.length);
  const pairs = firstRoundPairs(Array.from({ length: size }, () => null));
  const byePlaces = new Set(shuffled(pairs, random).slice(0, size - teamIds.length).map((p) => p[random() < 0.5 ? 0 : 1]));
  const teams = shuffled(teamIds, random);
  return Array.from({ length: size }, (_, i) => (byePlaces.has(i) ? null : teams.shift() ?? null));
}

/** True when some first-round match would be a bye against a bye. */
export function hasByeAgainstBye(seats: readonly (string | null)[]): boolean {
  return firstRoundPairs(seats).some(([a, b]) => seats[a] === null && seats[b] === null);
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

/**
 * Moves a whole first-round match to another match's number, swapping the two. The pairings stay
 * as they are; only where they sit in the bracket changes, and so who they can meet next.
 */
export function swapPairs(seats: readonly (string | null)[], from: number, to: number): Seats {
  const pairs = firstRoundPairs(seats);
  const next = [...seats];
  const x = pairs[from];
  const y = pairs[to];
  if (!x || !y || from === to) return next;
  [next[x[0]], next[y[0]]] = [seats[y[0]] ?? null, seats[x[0]] ?? null];
  [next[x[1]], next[y[1]]] = [seats[y[1]] ?? null, seats[x[1]] ?? null];
  return next;
}

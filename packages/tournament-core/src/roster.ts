export type Gender = 'male' | 'female';
export type RosterRole = 'mixed1' | 'mixed2' | 'woman';
export const ROSTER_ROLES: readonly RosterRole[] = ['mixed1', 'mixed2', 'woman'];

export interface RosterPlayer {
  id: string;
  name: string;
  gender: Gender;
  /** null while the organiser has not assigned this player (legacy rows). */
  role: RosterRole | null;
}

/** Which pair of a team plays a given game. */
export type PairSlot = 'mixed1' | 'mixed2' | 'mens';

export const PAIR_SLOT_LABEL: Record<PairSlot, string> = {
  mixed1: 'Mixed #1 pair', mixed2: 'Mixed #2 pair', mens: 'the two men',
};

/**
 * The club format: exactly two men and one woman. The woman plays both mixed games, the two men
 * play the men's doubles together, so a team is complete when each role appears once with the
 * right gender behind it.
 */
export function validateRoster(players: readonly RosterPlayer[]): { ok: true } | { ok: false; reason: string } {
  if (players.length !== 3) return { ok: false, reason: 'a team needs exactly 3 players' };
  if (players.some((p) => p.role === null)) return { ok: false, reason: 'every player needs a role' };
  const roles = new Set(players.map((p) => p.role));
  if (roles.size !== 3) return { ok: false, reason: 'roles mixed1, mixed2 and woman must each appear once' };
  const men = players.filter((p) => p.role === 'mixed1' || p.role === 'mixed2');
  if (men.some((p) => p.gender !== 'male')) return { ok: false, reason: 'the two mixed players must be men' };
  const woman = players.find((p) => p.role === 'woman')!;
  if (woman.gender !== 'female') return { ok: false, reason: 'the woman slot must be a woman' };
  return { ok: true };
}

/** The two players of a team who play `slot`, or null when the roster is not complete. */
export function pairFor(players: readonly RosterPlayer[], slot: PairSlot): [RosterPlayer, RosterPlayer] | null {
  if (!validateRoster(players).ok) return null;
  const byRole = (r: RosterRole) => players.find((p) => p.role === r)!;
  if (slot === 'mixed1') return [byRole('mixed1'), byRole('woman')];
  if (slot === 'mixed2') return [byRole('mixed2'), byRole('woman')];
  return [byRole('mixed1'), byRole('mixed2')];
}

/**
 * Fixed by position, not by the game's name, so renaming "Mixed doubles #1" changes nothing.
 * Any game past the third defaults to the men's doubles pair.
 */
export function pairSlotForGame(gameNo: number): PairSlot {
  return gameNo === 1 ? 'mixed1' : gameNo === 2 ? 'mixed2' : 'mens';
}

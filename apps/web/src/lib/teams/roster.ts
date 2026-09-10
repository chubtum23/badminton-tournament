import { pairFor, pairSlotForGame, type RosterPlayer } from '@tournament/core';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { parseProfileForm, type ProfileInput } from '@/lib/participant/profile';

export interface RosterInput { mixed1: string; mixed2: string; woman: string }
export interface SignupInput extends ProfileInput, RosterInput { joinCode: string }

export const ROSTER_ROLES = ['mixed1', 'mixed2', 'woman'] as const;
export type RosterRole = typeof ROSTER_ROLES[number];

/** The three sign-up boxes, in form order. The box decides the player's gender and role. */
export const ROSTER_FIELD_LABELS: Record<keyof RosterInput, string> = {
  mixed1: 'Man playing Mixed #1', mixed2: 'Man playing Mixed #2', woman: 'Woman',
};

/** A newly resized blob per role, where the picker put one. */
export function photoBlobsFrom(fd: FormData): Record<RosterRole, File | null> {
  const out: Record<RosterRole, File | null> = { mixed1: null, mixed2: null, woman: null };
  for (const role of ROSTER_ROLES) {
    const v = fd.get(`photo_${role}_file`);
    out[role] = v instanceof File && v.size > 0 ? v : null;
  }
  return out;
}

/** The path the form says is already stored for each role; empty means the player removed it. */
export function keptPathsFrom(fd: FormData): Record<RosterRole, string | null> {
  const out: Record<RosterRole, string | null> = { mixed1: null, mixed2: null, woman: null };
  for (const role of ROSTER_ROLES) {
    const v = String(fd.get(`photo_${role}`) ?? '').trim();
    out[role] = v === '' ? null : v;
  }
  return out;
}

export function rosterOf(team: Pick<TeamWithPlayers, 'players'>): RosterPlayer[] {
  return team.players.map((p) => ({ id: p.id, name: p.name, gender: p.gender, role: p.role }));
}

/** "Alex & Priya" for the pair of `team` that plays game `gameNo`; null while the roster is incomplete. */
export function pairNames(team: Pick<TeamWithPlayers, 'players'>, gameNo: number): string | null {
  const pair = pairFor(rosterOf(team), pairSlotForGame(gameNo));
  return pair ? `${pair[0].name} & ${pair[1].name}` : null;
}

export function parseRosterForm(fd: FormData): { ok: true; value: RosterInput } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const value = { mixed1: '', mixed2: '', woman: '' };
  for (const key of ROSTER_ROLES) {
    const v = String(fd.get(key) ?? '').trim();
    if (v.length === 0) problems.push(`${ROSTER_FIELD_LABELS[key]} is required`);
    else if (v.length > 60) problems.push(`${ROSTER_FIELD_LABELS[key]} must be at most 60 characters`);
    value[key] = v;
  }
  return problems.length ? { ok: false, problems } : { ok: true, value };
}

export function parseSignupForm(fd: FormData): { ok: true; value: SignupInput } | { ok: false; problems: string[] } {
  const profile = parseProfileForm(fd);
  const roster = parseRosterForm(fd);
  const problems = [...(profile.ok ? [] : profile.problems), ...(roster.ok ? [] : roster.problems)];
  if (!profile.ok || !roster.ok) return { ok: false, problems };
  return { ok: true, value: { ...profile.value, ...roster.value, joinCode: String(fd.get('joinCode') ?? '').trim() } };
}

const MESSAGES: Record<string, string> = {
  duplicate_name: 'That team name is already taken in this tournament',
  bad_join_code: 'That join code is not right',
  signup_closed: 'Sign-ups are closed',
  invalid_input: 'Check the names and try again',
  stale_state: 'The draw is locked, so teams cannot change',
};

/** The sentence for a roster function's raised message; anything unknown is passed through. */
export function rosterErrorMessage(dbMessage: string): string {
  return MESSAGES[dbMessage] ?? dbMessage;
}

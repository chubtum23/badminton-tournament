import { pairFor, pairSlotForGame } from '@tournament/core';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { rosterOf } from '@/lib/teams/roster';
import { decodeRallies, DEFAULT_START, encodeRallies } from './liveSheet';
import { validStart, type SheetStart, type Side } from './scoresheet';

/**
 * The free score sheet: one game scored on the organiser's phone and nothing else. It belongs to
 * no match and is never saved to the tournament; its main job is the men's doubles game that
 * breaks a tie in a pool, after which the organiser sorts the pool by hand.
 */
export interface FreeSide { teamId: string; label: string; players: [string, string] }
export interface FreeSheet { a: FreeSide; b: FreeSide; start: SheetStart; rallies: Side[] }

export const FREE_SHEET_KEY = (slug: string) => `free-scoresheet:${slug}`;

const blankSide = (n: number): FreeSide => ({ teamId: '', label: `Side ${n}`, players: ['', ''] });
export const blankSheet = (): FreeSheet => ({ a: blankSide(1), b: blankSide(2), start: DEFAULT_START, rallies: [] });

/** A team picked for a side brings its name and its two men, since a tiebreak is men's doubles. */
export function sideFromTeam(team: Pick<TeamWithPlayers, 'id' | 'name' | 'players'>): FreeSide {
  const pair = pairFor(rosterOf(team), pairSlotForGame(3));
  return { teamId: team.id, label: team.name, players: pair ? [pair[0].name, pair[1].name] : ['', ''] };
}

export const encodeFreeSheet = (s: FreeSheet): string => JSON.stringify({ ...s, rallies: encodeRallies(s.rallies) });

/** Reads back a stored sheet; anything unreadable starts a fresh one rather than breaking the page. */
export function decodeFreeSheet(raw: string | null): FreeSheet {
  if (!raw) return blankSheet();
  try {
    const v = JSON.parse(raw) as Partial<Omit<FreeSheet, 'rallies'>> & { rallies?: unknown };
    const side = (x: unknown, n: number): FreeSide => {
      const s = x as Partial<FreeSide> | undefined;
      const p = Array.isArray(s?.players) ? s.players : [];
      return {
        teamId: typeof s?.teamId === 'string' ? s.teamId : '',
        label: typeof s?.label === 'string' && s.label.trim() ? s.label : `Side ${n}`,
        players: [String(p[0] ?? ''), String(p[1] ?? '')],
      };
    };
    const rallies = typeof v.rallies === 'string' ? decodeRallies(v.rallies) : null;
    const start = v.start && validStart(v.start) ? v.start : DEFAULT_START;
    return { a: side(v.a, 1), b: side(v.b, 2), start, rallies: rallies ?? [] };
  } catch {
    return blankSheet();
  }
}

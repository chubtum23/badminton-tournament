import { BADMINTON_DEFAULTS, pairFor, pairSlotForGame, type Settings } from '@tournament/core';
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
/** The club game whatever the event is set to: one game to 15, no win-by-two, a 13-minute clock. */
export const FREE_SHEET_SETTINGS: Settings = { ...BADMINTON_DEFAULTS, gamesPerMatch: 1, playAllGames: false };

/** The clock as ISO times, like a game on court: null startedAt means it has not been started. */
export interface FreeClock { startedAt: string | null; pausedAt: string | null; pausedMs: number }
export interface FreeSheet { a: FreeSide; b: FreeSide; start: SheetStart; rallies: Side[]; clock: FreeClock }

export const FREE_SHEET_KEY = (slug: string) => `free-scoresheet:${slug}`;

const blankSide = (n: number): FreeSide => ({ teamId: '', label: `Side ${n}`, players: ['', ''] });
const blankClock = (): FreeClock => ({ startedAt: null, pausedAt: null, pausedMs: 0 });
export const blankSheet = (): FreeSheet => ({ a: blankSide(1), b: blankSide(2), start: DEFAULT_START, rallies: [], clock: blankClock() });

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
    const v = JSON.parse(raw) as Partial<Omit<FreeSheet, 'rallies' | 'clock'>> & { rallies?: unknown };
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
    const c = (v as { clock?: Partial<FreeClock> }).clock;
    const iso = (x: unknown) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null);
    const startedAt = iso(c?.startedAt);
    const clock = startedAt
      ? { startedAt, pausedAt: iso(c?.pausedAt), pausedMs: typeof c?.pausedMs === 'number' && c.pausedMs >= 0 ? c.pausedMs : 0 }
      : blankClock();
    return { a: side(v.a, 1), b: side(v.b, 2), start, rallies: rallies ?? [], clock };
  } catch {
    return blankSheet();
  }
}

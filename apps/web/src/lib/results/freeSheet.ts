import { BADMINTON_DEFAULTS, pairFor, pairSlotForGame, type Settings } from '@tournament/core';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { rosterOf } from '@/lib/teams/roster';
import { decodeRallies, DEFAULT_START, encodeRallies } from './liveSheet';
import { replay, validStart, type SheetStart, type Side } from './scoresheet';

/**
 * The free score sheet: one game scored on the organiser's phone and nothing else. It belongs to
 * no match and is never saved to the tournament; its main job is the men's doubles game that
 * breaks a tie in a pool, after which the organiser sorts the pool by hand.
 */
export interface FreeSide { teamId: string; label: string; players: [string, string] }
/** One game with no win-by-two and no clock, whatever the event is set to: first to 15 unless the game says otherwise. */
export const FREE_SHEET_SETTINGS: Settings = { ...BADMINTON_DEFAULTS, gamesPerMatch: 1, playAllGames: false, timeCapMinutes: null };

/** The most points a game can be played to; anything from 1 up is allowed. */
export const MAX_FREE_TARGET = 99;
export const validTarget = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_FREE_TARGET;

/** The rules one game is scored by: the club game, first to its own target. */
export const freeSettings = (target: number): Settings => ({ ...FREE_SHEET_SETTINGS, pointsPerGame: target });

export interface FreeSheet { a: FreeSide; b: FreeSide; start: SheetStart; rallies: Side[]; target: number }

export const FREE_SHEET_KEY = (slug: string) => `free-scoresheet:${slug}`;

const blankSide = (n: number): FreeSide => ({ teamId: '', label: `Side ${n}`, players: ['', ''] });
export const blankSheet = (): FreeSheet =>
  ({ a: blankSide(1), b: blankSide(2), start: DEFAULT_START, rallies: [], target: FREE_SHEET_SETTINGS.pointsPerGame });

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
    const target = validTarget(v.target) ? v.target : FREE_SHEET_SETTINGS.pointsPerGame;
    return { a: side(v.a, 1), b: side(v.b, 2), start, rallies: rallies ?? [], target };
  } catch {
    return blankSheet();
  }
}

/** A game already played on this phone, as the history list shows it. */
export interface PastGame {
  id: string;
  /** When it was put away, ISO. */
  at: string;
  a: string; b: string;
  pairA: string; pairB: string;
  scoreA: number; scoreB: number;
  /** The points it was played to; 0 for games kept from before a game could have its own. */
  target: number;
  /** The winning side's label, or null when it was put away unfinished. */
  winner: string | null;
  /** Only games kept from when the sheet had a clock can have been won on time. */
  byTime: boolean;
  /** The organiser gave the game to the winner, whatever the score. */
  awarded: boolean;
}

export const FREE_HISTORY_KEY = (slug: string) => `free-scoresheet-history:${slug}`;

const pair = (side: FreeSide) => side.players.filter((p) => p.trim()).join(' & ');

/**
 * The current sheet as a history entry. `award` gives the game to that side whatever the score,
 * even before a rally; otherwise it is null when not a rally has been played.
 */
export function pastGameOf(sheet: FreeSheet, id: string, now: number, award?: Side): PastGame | null {
  if (sheet.rallies.length === 0 && !award) return null;
  const t = replay(freeSettings(sheet.target), sheet.start, sheet.rallies);
  const lead: Side | null = award ?? (t.finished ? t.winner : null);
  return {
    id, at: new Date(now).toISOString(), a: sheet.a.label, b: sheet.b.label, pairA: pair(sheet.a), pairB: pair(sheet.b),
    scoreA: t.scoreA, scoreB: t.scoreB, target: sheet.target,
    winner: lead === null ? null : lead === 'a' ? sheet.a.label : sheet.b.label, byTime: false, awarded: award !== undefined,
  };
}

/** Reads the history back, dropping anything malformed rather than failing the page. */
export function decodeHistory(raw: string | null): PastGame[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const str = (x: unknown) => (typeof x === 'string' ? x : '');
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    return v.filter((g) => g && typeof g === 'object' && typeof g.id === 'string').map((g) => ({
      id: g.id, at: str(g.at), a: str(g.a), b: str(g.b), pairA: str(g.pairA), pairB: str(g.pairB),
      scoreA: num(g.scoreA), scoreB: num(g.scoreB), target: num(g.target),
      winner: typeof g.winner === 'string' ? g.winner : null, byTime: g.byTime === true, awarded: g.awarded === true,
    }));
  } catch {
    return [];
  }
}

/** Several games can be scored side by side; each keeps its own sides and sheet. */
export interface FreeGame { id: string; sheet: FreeSheet }

export const FREE_GAMES_KEY = (slug: string) => `free-scoresheets:${slug}`;

export const encodeFreeGames = (games: readonly FreeGame[]): string =>
  JSON.stringify(games.map((g) => ({ id: g.id, ...(JSON.parse(encodeFreeSheet(g.sheet)) as object) })));

/**
 * Reads the games back. `legacy` is the one-game sheet stored before there could be several: if
 * there is no list yet and it holds anything, it becomes the first game rather than vanishing.
 */
export function decodeFreeGames(raw: string | null, legacy: string | null, newId: () => string): FreeGame[] {
  if (raw) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v)) {
        return v.filter((x) => x && typeof x === 'object' && typeof x.id === 'string')
          .map((x) => ({ id: x.id as string, sheet: decodeFreeSheet(JSON.stringify(x)) }));
      }
    } catch { /* fall through to the legacy sheet */ }
  }
  const old = decodeFreeSheet(legacy);
  const used = old.rallies.length > 0 || old.a.teamId !== '' || old.b.teamId !== '';
  return used ? [{ id: newId(), sheet: old }] : [];
}

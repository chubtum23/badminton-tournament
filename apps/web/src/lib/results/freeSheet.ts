import { BADMINTON_DEFAULTS, pairFor, pairSlotForGame, type Settings } from '@tournament/core';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { rosterOf } from '@/lib/teams/roster';
import { decodeRallies, DEFAULT_START, encodeRallies } from './liveSheet';
import { remainingMs } from './clock';
import { replay, validStart, type SheetStart, type Side } from './scoresheet';

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

/** A game already played on this phone, as the history list shows it. */
export interface PastGame {
  id: string;
  /** When it was put away, ISO. */
  at: string;
  a: string; b: string;
  pairA: string; pairB: string;
  scoreA: number; scoreB: number;
  /** The winning side's label, or null when it was put away unfinished. */
  winner: string | null;
  byTime: boolean;
}

export const FREE_HISTORY_KEY = (slug: string) => `free-scoresheet-history:${slug}`;

const pair = (side: FreeSide) => side.players.filter((p) => p.trim()).join(' & ');

/** The current sheet as a history entry; null when not a rally has been played. */
export function pastGameOf(sheet: FreeSheet, id: string, now: number): PastGame | null {
  if (sheet.rallies.length === 0) return null;
  const t = replay(FREE_SHEET_SETTINGS, sheet.start, sheet.rallies);
  const timeUp = remainingMs({ ...sheet.clock, capMinutes: FREE_SHEET_SETTINGS.timeCapMinutes }, now) === 0;
  const byTime = !t.finished && timeUp && t.scoreA !== t.scoreB;
  const lead: Side | null = t.finished ? t.winner : byTime ? (t.scoreA > t.scoreB ? 'a' : 'b') : null;
  return {
    id, at: new Date(now).toISOString(), a: sheet.a.label, b: sheet.b.label, pairA: pair(sheet.a), pairB: pair(sheet.b),
    scoreA: t.scoreA, scoreB: t.scoreB, winner: lead === null ? null : lead === 'a' ? sheet.a.label : sheet.b.label, byTime,
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
      scoreA: num(g.scoreA), scoreB: num(g.scoreB), winner: typeof g.winner === 'string' ? g.winner : null, byTime: g.byTime === true,
    }));
  } catch {
    return [];
  }
}

/** Several games can be scored side by side; each keeps its own sides, sheet and clock. */
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
  const used = old.rallies.length > 0 || old.a.teamId !== '' || old.b.teamId !== '' || old.clock.startedAt !== null;
  return used ? [{ id: newId(), sheet: old }] : [];
}

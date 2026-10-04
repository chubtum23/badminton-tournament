import { describe, expect, it } from 'vitest';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { blankSheet, decodeFreeSheet, decodeHistory, encodeFreeSheet, FREE_SHEET_SETTINGS, pastGameOf, sideFromTeam } from './freeSheet';

const player = (id: string, name: string, gender: 'male' | 'female', role: 'mixed1' | 'mixed2' | 'woman') =>
  ({ id, tournament_id: 't', name, gender, role });

const team = {
  id: 'team5', name: 'Team 5',
  players: [player('p1', 'Tomoya Kumita', 'male', 'mixed1'), player('p2', 'Anh Tuan Cao', 'male', 'mixed2'), player('p3', 'Mei Miyazaki', 'female', 'woman')],
} as unknown as TeamWithPlayers;

describe('sideFromTeam', () => {
  it('brings the team name and its two men for a men\'s doubles tiebreak', () =>
    expect(sideFromTeam(team)).toEqual({ teamId: 'team5', label: 'Team 5', players: ['Tomoya Kumita', 'Anh Tuan Cao'] }));

  it('leaves the names blank to type when the roster is incomplete', () =>
    expect(sideFromTeam({ ...team, players: [] }).players).toEqual(['', '']));
});

describe('FREE_SHEET_SETTINGS', () => {
  it('is the club game: one game to 15, no win-by-two, a 13-minute clock', () =>
    expect(FREE_SHEET_SETTINGS).toMatchObject({ gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: 13 }));
});

describe('free sheet storage', () => {
  it('keeps a running or paused clock across a refresh', () => {
    const clock = { startedAt: '2026-10-04T09:00:00.000Z', pausedAt: '2026-10-04T09:05:00.000Z', pausedMs: 30_000 };
    expect(decodeFreeSheet(encodeFreeSheet({ ...blankSheet(), clock })).clock).toEqual(clock);
  });

  it('treats a clock with no valid start as not started', () =>
    expect(decodeFreeSheet(JSON.stringify({ clock: { startedAt: 'soon', pausedMs: -5 } })).clock).toEqual(blankSheet().clock));

  it('round-trips a sheet in progress', () => {
    const sheet = { ...blankSheet(), a: sideFromTeam(team), start: { server: 1, receiver: 3 }, rallies: ['a', 'b', 'a'] as const };
    expect(decodeFreeSheet(encodeFreeSheet({ ...sheet, rallies: [...sheet.rallies] }))).toEqual({ ...sheet, rallies: ['a', 'b', 'a'] });
  });

  it('starts fresh from nothing or from junk', () => {
    expect(decodeFreeSheet(null)).toEqual(blankSheet());
    expect(decodeFreeSheet('{not json')).toEqual(blankSheet());
    expect(decodeFreeSheet(JSON.stringify({ rallies: 'xyz', start: { server: 0, receiver: 1 } }))).toEqual(blankSheet());
  });
});

describe('pastGameOf', () => {
  const sides = { ...blankSheet(), a: sideFromTeam(team), b: { teamId: '', label: 'Team 12', players: ['Bojian Ren', 'Guangxin Liu'] as [string, string] } };
  const now = Date.parse('2026-10-04T10:00:00.000Z');

  it('is nothing before a rally is played', () => expect(pastGameOf(sides, 'g1', now)).toBeNull());

  it('records a finished game with its winner', () => {
    const g = pastGameOf({ ...sides, rallies: Array(15).fill('b') }, 'g1', now)!;
    expect(g).toMatchObject({ a: 'Team 5', b: 'Team 12', pairA: 'Tomoya Kumita & Anh Tuan Cao', scoreA: 0, scoreB: 15, winner: 'Team 12', byTime: false });
  });

  it('gives a game the leader when the clock has run out', () => {
    const clock = { startedAt: '2026-10-04T09:40:00.000Z', pausedAt: null, pausedMs: 0 };
    expect(pastGameOf({ ...sides, clock, rallies: ['a', 'a', 'b'] }, 'g1', now)).toMatchObject({ scoreA: 2, scoreB: 1, winner: 'Team 5', byTime: true });
  });

  it('leaves an unfinished game with no winner', () =>
    expect(pastGameOf({ ...sides, rallies: ['a'] }, 'g1', now)?.winner).toBeNull());
});

describe('decodeHistory', () => {
  it('drops junk and keeps good entries', () => {
    const good = { id: 'g1', at: 'x', a: 'A', b: 'B', pairA: '', pairB: '', scoreA: 15, scoreB: 9, winner: 'A', byTime: false };
    expect(decodeHistory(JSON.stringify([good, 7, { no: 'id' }]))).toEqual([good]);
    expect(decodeHistory('nope')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { TeamWithPlayers } from '@/lib/db/queries';
import { blankSheet, decodeFreeGames, decodeFreeSheet, decodeHistory, encodeFreeGames, encodeFreeSheet, FREE_SHEET_SETTINGS, freeSettings, pastGameOf, sideFromTeam } from './freeSheet';

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
  it('is one game to 15, no win-by-two and no clock', () =>
    expect(FREE_SHEET_SETTINGS).toMatchObject({ gamesPerMatch: 1, pointsPerGame: 15, winByTwo: false, maxPoints: null, timeCapMinutes: null }));
});

describe('free sheet storage', () => {
  it('drops the clock a sheet was stored with before the clock went', () =>
    expect(decodeFreeSheet(JSON.stringify({ clock: { startedAt: '2026-10-04T09:00:00.000Z', pausedMs: 0 } }))).toEqual(blankSheet()));

  it('round-trips a sheet in progress', () => {
    const sheet = { ...blankSheet(), a: sideFromTeam(team), start: { server: 1, receiver: 3 }, rallies: ['a', 'b', 'a'] as const };
    expect(decodeFreeSheet(encodeFreeSheet({ ...sheet, rallies: [...sheet.rallies] }))).toEqual({ ...sheet, rallies: ['a', 'b', 'a'] });
  });

  it('keeps the points a game is played to, and starts at 15 for anything else', () => {
    expect(blankSheet().target).toBe(15);
    expect(decodeFreeSheet(encodeFreeSheet({ ...blankSheet(), target: 21 })).target).toBe(21);
    for (const target of [0, -3, 2.5, 100, '21']) expect(decodeFreeSheet(JSON.stringify({ target })).target).toBe(15);
  });

  it('plays a game to its own target', () =>
    expect(freeSettings(7)).toMatchObject({ pointsPerGame: 7, winByTwo: false, maxPoints: null, timeCapMinutes: null }));

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

  it('finishes at the game target', () => {
    expect(pastGameOf({ ...sides, target: 21, rallies: Array(15).fill('b') }, 'g1', now)?.winner).toBeNull();
    expect(pastGameOf({ ...sides, target: 21, rallies: Array(21).fill('b') }, 'g1', now)).toMatchObject({ scoreB: 21, target: 21, winner: 'Team 12' });
  });

  it('awards a game to either side whatever the score, even before a rally', () => {
    expect(pastGameOf({ ...sides, rallies: ['b', 'b', 'a'] }, 'g1', now, 'a')).toMatchObject({ scoreA: 1, scoreB: 2, winner: 'Team 5', awarded: true });
    expect(pastGameOf(sides, 'g1', now, 'b')).toMatchObject({ scoreA: 0, scoreB: 0, winner: 'Team 12', awarded: true });
    expect(pastGameOf({ ...sides, rallies: Array(15).fill('b') }, 'g1', now)?.awarded).toBe(false);
  });

  it('leaves an unfinished game with no winner', () =>
    expect(pastGameOf({ ...sides, rallies: ['a'] }, 'g1', now)?.winner).toBeNull());
});

describe('decodeHistory', () => {
  it('drops junk and keeps good entries', () => {
    const good = { id: 'g1', at: 'x', a: 'A', b: 'B', pairA: '', pairB: '', scoreA: 15, scoreB: 9, target: 15, winner: 'A', byTime: false, awarded: true };
    expect(decodeHistory(JSON.stringify([good, 7, { no: 'id' }]))).toEqual([good]);
    expect(decodeHistory('nope')).toEqual([]);
  });
});

describe('several games at once', () => {
  let n = 0;
  const newId = () => `new${++n}`;

  it('round-trips a list of games, each with its own sheet', () => {
    const games = [
      { id: 'g1', sheet: { ...blankSheet(), a: sideFromTeam(team), rallies: ['a', 'b'] as ('a' | 'b')[] } },
      { id: 'g2', sheet: blankSheet() },
    ];
    expect(decodeFreeGames(encodeFreeGames(games), null, newId)).toEqual(games);
  });

  it('turns an old single sheet in use into the first game', () => {
    const legacy = encodeFreeSheet({ ...blankSheet(), rallies: ['a'] });
    expect(decodeFreeGames(null, legacy, () => 'g0')).toEqual([{ id: 'g0', sheet: { ...blankSheet(), rallies: ['a'] } }]);
  });

  it('starts empty when there is nothing stored, or only an untouched old sheet', () => {
    expect(decodeFreeGames(null, null, newId)).toEqual([]);
    expect(decodeFreeGames(null, encodeFreeSheet(blankSheet()), newId)).toEqual([]);
    expect(decodeFreeGames('[{"no":"id"}, 4]', null, newId)).toEqual([]);
  });
});

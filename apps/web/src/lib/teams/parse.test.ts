import { describe, it, expect } from 'vitest';
import { parseTeamLines } from './parse';

describe('parseTeamLines', () => {
  it('parses pairs and derives a team name', () => {
    const r = parseTeamLines('Alice & Bob\nCara + Dan\n');
    expect(r.problems).toEqual([]);
    expect(r.teams).toEqual([
      { name: 'Alice & Bob', players: ['Alice', 'Bob'] },
      { name: 'Cara & Dan', players: ['Cara', 'Dan'] },
    ]);
  });
  it('accepts singles and explicit team names', () => {
    const r = parseTeamLines('Eve\nFay / Gus = Smash Bros');
    expect(r.teams).toEqual([
      { name: 'Eve', players: ['Eve'] },
      { name: 'Smash Bros', players: ['Fay', 'Gus'] },
    ]);
  });
  it('rejects blank names, more than two players and duplicate players', () => {
    const r = parseTeamLines('A, B, C\nAlice & Bob\nalice & Zed\n = Nameless');
    expect(r.problems).toEqual([
      'line 1: a team has at most 2 players',
      'line 3: player "alice" appears more than once',
      'line 4: no player names',
    ]);
  });
  it('rejects a player name longer than 60 characters', () => {
    const long = 'x'.repeat(61);
    const r = parseTeamLines(`${long} & Bob`);
    expect(r.problems).toEqual(['line 1: player name longer than 60 characters']);
    expect(r.teams).toEqual([]);
  });
  it('rejects a team name longer than 40 characters, derived or explicit', () => {
    const explicit = parseTeamLines(`Alice & Bob = ${'y'.repeat(41)}`);
    expect(explicit.problems).toEqual(['line 1: team name longer than 40 characters']);
    const derived = parseTeamLines(`${'a'.repeat(30)} & ${'b'.repeat(30)}`);
    expect(derived.problems).toEqual(['line 1: team name longer than 40 characters']);
    expect(derived.teams).toEqual([]);
  });
  it('accepts names exactly on the limits', () => {
    const r = parseTeamLines(`Alice & Bob = ${'y'.repeat(40)}`);
    expect(r.problems).toEqual([]);
    expect(r.teams[0]!.name).toHaveLength(40);
  });
  it('ignores blank lines and trims whitespace', () => {
    const r = parseTeamLines('\n  Hal &  Ida  \n\n');
    expect(r.teams).toEqual([{ name: 'Hal & Ida', players: ['Hal', 'Ida'] }]);
  });
});

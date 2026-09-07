import { describe, it, expect } from 'vitest';
import * as core from './index';

describe('public API', () => {
  it('exports every rule function', () => {
    const expected = [
      'BADMINTON_DEFAULTS', 'validateGame', 'matchResult', 'gamesNeeded', 'winnerTeamId', 'validateSettings',
      'shuffle', 'assignPools', 'roundRobin', 'poolMatches',
      'poolStandings', 'bracketSize', 'bracketOrder', 'seedQualifiers', 'buildBracket',
      'advance', 'rollback',
    ];
    for (const name of expected) expect(core, name).toHaveProperty(name);
  });
});

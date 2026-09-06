export interface ParsedTeam {
  name: string;
  players: string[];
}

/**
 * One team per line. Players separated by &, +, / or ,. Optional " = Team Name" suffix.
 * Line numbers in problems are 1-based over the original text (blank lines count).
 */
export function parseTeamLines(text: string): { teams: ParsedTeam[]; problems: string[] } {
  const teams: ParsedTeam[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const n = i + 1;
    const [playersPart, ...namePart] = line.split('=');
    const explicitName = namePart.join('=').trim();
    const players = (playersPart ?? '').split(/[&+/,]/).map((p) => p.trim()).filter(Boolean);
    if (players.length === 0) { problems.push(`line ${n}: no player names`); return; }
    if (players.length > 2) { problems.push(`line ${n}: a team has at most 2 players`); return; }
    // Mirrors the database checks: players.name <= 60, teams.name <= 40.
    if (players.some((p) => p.length > 60)) { problems.push(`line ${n}: player name longer than 60 characters`); return; }
    let duplicate = false;
    for (const p of players) {
      const key = p.toLowerCase();
      if (seen.has(key)) { problems.push(`line ${n}: player "${p}" appears more than once`); duplicate = true; break; }
    }
    if (duplicate) return;
    const name = explicitName || players.join(' & ');
    if (name.length > 40) { problems.push(`line ${n}: team name longer than 40 characters`); return; }
    for (const p of players) seen.add(p.toLowerCase());
    teams.push({ name, players });
  });
  return { teams, problems };
}

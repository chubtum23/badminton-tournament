import type { Game } from '@tournament/core';

export type ParsedGames = { ok: true; games: Game[] } | { ok: false; message: string; gameNo: number };

/**
 * A participant's whole-meeting score entry, read strictly. The organiser's reader
 * (`gamesFromForm` in lib/results/form) stops at the first blank pair and reads a lone blank box as
 * 0; here a row with one box blank is an error, and so is a blank row with a filled one after it.
 * Only trailing blank rows mean "not played yet".
 *
 * Takes a field reader rather than FormData so the score form can run the same rules over its
 * live input state and show the server's sentence before anything is sent. `game{n}x` is the
 * time-up box: any non-empty value means ticked.
 */
export function parseGameRows(
  read: (field: string) => string,
  maxGames: number,
  label: (gameNo: number) => string = (n) => `Game ${n}`,
): ParsedGames {
  const games: Game[] = [];
  let blank: number | null = null;
  for (let n = 1; n <= maxGames; n++) {
    const a = read(`game${n}a`).trim();
    const b = read(`game${n}b`).trim();
    if (a === '' && b === '') { blank ??= n; continue; }
    if (a === '' || b === '') return { ok: false, message: `Enter both scores for ${label(n)}`, gameNo: n };
    if (blank !== null) return { ok: false, message: `Enter the scores for ${label(blank)}`, gameNo: blank };
    games.push({ gameNo: n, scoreA: Number(a), scoreB: Number(b), timeExpired: read(`game${n}x`) !== '' });
  }
  return { ok: true, games };
}

/** `parseGameRows` over a submitted form. */
export function parseGamesForm(formData: FormData, maxGames: number, label?: (gameNo: number) => string): ParsedGames {
  return parseGameRows((f) => String(formData.get(f) ?? ''), maxGames, label);
}

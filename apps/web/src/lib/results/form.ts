import type { Game } from '@tournament/core';

/** Parses game{n}a / game{n}b fields; stops at the first blank pair. */
export function gamesFromForm(formData: FormData, maxGames: number): Game[] {
  const games: Game[] = [];
  for (let n = 1; n <= maxGames; n++) {
    const a = String(formData.get(`game${n}a`) ?? '').trim();
    const b = String(formData.get(`game${n}b`) ?? '').trim();
    if (a === '' && b === '') break;
    games.push({ gameNo: n, scoreA: Number(a), scoreB: Number(b) });
  }
  return games;
}

import { test, expect, type Page } from '@playwright/test';
import { addTeams, aIsSideA, drawAndLock, fillScores, meetingCard, openFirstGame, openMeetings, openTeamRow, playGames, playersOf, signIn } from './helpers';

const slug = `club-${Date.now().toString(36)}`;
// One pool of 4 -> 6 meetings; we engineer a 2nd/3rd tie: A beats everyone; B beats C; C beats D; D beats B.
const teams = ['Alpha & Ana', 'Bravo & Bea', 'Charlie & Cho', 'Delta & Dee'];
const GAME_LABELS = ['Mixed doubles #1', 'Mixed doubles #2', "Men's doubles"] as const;

/**
 * Plays every game of the open meeting between two named teams, so that `a` wins it. All three
 * games are always played, so `a` takes games 1 and 2 and `b` takes game 3: the meeting goes to
 * `a` two games to one and its net points difference is exactly `sa - sb`, which is what the
 * standings below are engineered around.
 */
async function enterResult(page: Page, a: string, b: string, sa: number, sb: number, timeUp = false) {
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const card = meetingCard(page, a, b);
  const first = await aIsSideA(card, a);
  const win: readonly [number, number] = first ? [sa, sb] : [sb, sa];
  const lose: readonly [number, number] = first ? [sb, sa] : [sa, sb];
  await playGames(card, [win, win, lose], timeUp);
  await expect(card).toHaveCount(0);
}

test('club format: clock, time-expired results, awards, withdrawal, playoff, bracket replacement', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await signIn(page);

  // create with date and venue
  await page.fill('input[name="name"]', 'Club Night');
  await page.fill('input[name="slug"]', slug);
  await page.fill('input[name="startsAtLocal"]', '2026-10-03T19:00');
  await page.fill('input[name="venue"]', 'Riverside Sports Hall');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await page.goto(`/t/${slug}`);
  // Date and venue share one header line, so both assertions land on the same paragraph.
  await expect(page.getByText('Riverside Sports Hall')).toBeVisible();
  await expect(page.getByText(/2026/)).toBeVisible();

  // teams, one pool, lock
  await addTeams(page, slug, teams);
  await drawAndLock(page, slug, 1);

  // Each game names the pair playing it, worked out from the roster: the woman partners a
  // different man in each mixed game and the two men play the men's doubles together.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const alpha = playersOf('Alpha & Ana');
  const alphaCard = openMeetings(page).filter({ hasText: 'Alpha & Ana' }).first();
  const pairs = alphaCard.getByTestId('pair-names');
  await expect(pairs).toHaveCount(3);
  await expect(pairs.nth(0)).toContainText(`${alpha.mixed1} & ${alpha.woman}`);
  await expect(pairs.nth(1)).toContainText(`${alpha.mixed2} & ${alpha.woman}`);
  await expect(pairs.nth(2)).toContainText(`${alpha.mixed1} & ${alpha.mixed2}`);

  // A meeting is three labelled games, and every one of them is listed on its card.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const anyCard = openMeetings(page).first();
  for (const label of GAME_LABELS) {
    await expect(anyCard.getByText(label, { exact: true })).toBeVisible();
  }

  // Start now on the first open game: it goes to a court of its own and the Now playing box at the
  // top of the screen picks it up, clock and all. The public live board shows the same box.
  await page.getByRole('button', { name: 'Start', exact: true }).first().click();
  const nowPlaying = page.getByTestId('now-playing');
  await expect(nowPlaying.getByTestId('court-clock')).toBeVisible();
  await expect(nowPlaying.getByText(GAME_LABELS[0], { exact: true })).toBeVisible();
  await page.goto(`/t/${slug}`);
  await expect(page.getByTestId('now-playing').getByTestId('court-clock')).toHaveText(/\d\d:\d\d|TIME/);

  // Pause stops that game's clock; Resume starts it counting again. The clock belongs to the game,
  // so both controls live on the game's line inside the Now playing box.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const playing = page.getByTestId('now-playing');
  await playing.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(playing.getByTestId('court-clock')).toHaveText(/\d\d:\d\d paused/);
  await playing.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(playing.getByTestId('court-clock')).toHaveText(/^\d\d:\d\d$/);

  // invalid single game 14-12 keeps Save disabled and shows the reason. Scoped to a meeting card,
  // because the game on court renders its form in the Now playing box as well.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const first = await openFirstGame(openMeetings(page).first());
  await fillScores(first, 14, 12);
  await expect(first.getByText('winner must reach 15', { exact: true })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Save' })).toBeDisabled();

  // Two games to nil does not end a meeting: the third is always played, and only then does the
  // meeting leave the open list.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const opener = meetingCard(page, 'Alpha & Ana', 'Bravo & Bea');
  const alphaFirst = await aIsSideA(opener, 'Alpha & Ana');
  const alphaWins: readonly [number, number] = alphaFirst ? [15, 9] : [9, 15];
  const bravoWins: readonly [number, number] = alphaFirst ? [9, 15] : [15, 9];
  await playGames(opener, [alphaWins, alphaWins]);
  await expect(opener).toHaveCount(1);
  await expect(opener.locator('[data-testid="game-row"][data-scored="false"]')).toHaveCount(1);
  await playGames(opener, [bravoWins]);
  await expect(opener).toHaveCount(0);

  // results: A beats all by 6 on aggregate; B beats C, C beats D (time expired 10-4), D beats B.
  // B, C, D end on 1 point each with a circular head-to-head and identical -6 score difference.
  await enterResult(page, 'Alpha & Ana', 'Charlie & Cho', 15, 9);
  await enterResult(page, 'Alpha & Ana', 'Delta & Dee', 15, 9);
  await enterResult(page, 'Bravo & Bea', 'Charlie & Cho', 15, 9);
  await enterResult(page, 'Charlie & Cho', 'Delta & Dee', 10, 4, true);
  await enterResult(page, 'Delta & Dee', 'Bravo & Bea', 15, 9);
  await page.goto(`/admin/${slug}/matches?pool=all`);
  await expect(page.getByText('Nothing waiting.')).toBeVisible();

  // unresolved three-way tie touching the qualification line
  await page.goto(`/admin/${slug}/standings`);
  await expect(page.getByText(/tied for the last qualifying place|tie on the qualification line/i)).toBeVisible();
  // knockout refuses until resolved
  await page.goto(`/admin/${slug}/draw`);
  await expect(page.getByText(/unresolved tie/i)).toBeVisible();

  // record a playoff between two of the tied teams. The form is prefilled with the first two names
  // in the tie group (Bravo and Charlie), which is what we want here.
  await page.goto(`/admin/${slug}/standings`);
  await page.getByRole('button', { name: /Record men.s doubles playoff/ }).click();
  await expect(page.getByText('Playoff created')).toBeVisible();
  // The playoff is a real meeting on the open list labelled "<pool> · playoff", but it is a single
  // men's doubles game: scoring that one game decides it.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const playoffCard = openMeetings(page)
    .filter({ hasText: /playoff/i }).first();
  await expect(playoffCard).toBeVisible();
  await expect(playoffCard.getByText("Men's doubles playoff", { exact: true })).toBeVisible();
  await playGames(playoffCard, [[15, 9]]);
  await expect(playoffCard).toHaveCount(0);
  // The public pools page lists it under its own "Playoff" heading (inside the collapsed
  // "Matches (n/n played)" disclosure, which counts pool matches only).
  await page.goto(`/t/${slug}/pools`);
  await page.locator('summary').first().click();
  await expect(page.getByRole('heading', { name: 'Playoff' })).toBeVisible();
  // One playoff does not settle a three-way tie: poolStandings only uses a playoff to separate a
  // group of exactly two, so Bravo/Charlie/Delta are still level and the warning stands. The
  // manual order below is what actually resolves it.
  await page.goto(`/admin/${slug}/standings`);
  await expect(page.getByText(/tied for the last qualifying place|tie on the qualification line/i)).toBeVisible();

  // set the order manually: A, C, B, D
  await page.goto(`/admin/${slug}/standings`);
  const order = { 'Alpha & Ana': '1', 'Charlie & Cho': '2', 'Bravo & Bea': '3', 'Delta & Dee': '4' } as const;
  for (const [name, rank] of Object.entries(order)) {
    const row = page.locator('tr', { hasText: name }).first();
    await row.locator('select').selectOption(rank);
  }
  await page.getByRole('button', { name: 'Set finishing order' }).click();
  await expect(page.getByText('Order set by organiser')).toBeVisible();
  await page.goto(`/t/${slug}/pools`);
  await expect(page.getByText('Order set by organiser')).toBeVisible();
  await expect(page.locator('tr[data-qualifies]')).toHaveCount(2);

  // start knockout (2 qualifiers -> a single final) and replace Charlie with Bravo in the final
  await page.goto(`/admin/${slug}/draw`);
  await page.getByRole('button', { name: 'Start knockout with this bracket' }).click();
  await expect(page.getByText('Knockout started')).toBeVisible();
  const replace = page.locator('form', { has: page.locator('select[name="side"]') }).first();
  await replace.locator('select[name="side"]').selectOption('b');
  await replace.locator('select[name="teamId"]').selectOption({ label: 'Bravo & Bea' });
  await replace.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText('Team replaced')).toBeVisible();
  // The "replace a team" row names the match's two sides, so this pins the swap to the final
  // itself rather than to any of the several places the name is now rendered.
  await expect(page.getByText('Alpha & Ana v Bravo & Bea')).toBeVisible();

  // withdraw Bravo: the final is forfeited to Alpha and the tournament finishes
  await page.goto(`/admin/${slug}/teams`);
  const bravoRow = await openTeamRow(page, 'Bravo & Bea');
  await bravoRow.getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.getByText(/withdrawn/i).first()).toBeVisible();
  await page.goto(`/t/${slug}/bracket`);
  await expect(page.getByText(/Champions: Alpha & Ana/)).toBeVisible();
  await expect(page.getByText(/forfeit/i).first()).toBeVisible();

  // override the done final: award it to Bravo (organiser decision) -> champion changes, label "awarded".
  // Alpha and Bravo also met in the pool, and pool matches sort first, so the card is pinned by its
  // knockout label ("Round 1 · #1") as well as by the two team names.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const finalCard = page.getByTestId('match-card')
    .filter({ hasText: 'Round 1' }).filter({ hasText: 'Alpha & Ana' }).filter({ hasText: 'Bravo & Bea' }).first();
  await finalCard.getByRole('button', { name: 'Award to Bravo & Bea' }).click();
  await expect(page.getByText('Match awarded')).toBeVisible();
  await page.goto(`/t/${slug}/bracket`);
  await expect(page.getByText(/Champions: Bravo & Bea/)).toBeVisible();
  await expect(page.getByText(/awarded/i).first()).toBeVisible();
});

import { test, expect, type Locator, type Page } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const slug = `club-${Date.now().toString(36)}`;
// One pool of 4 -> 6 meetings; we engineer a 2nd/3rd tie: A beats everyone; B beats C; C beats D; D beats B.
const teams = ['Alpha & Ana', 'Bravo & Bea', 'Charlie & Cho', 'Delta & Dee'];
const GAME_LABELS = ['Mixed doubles #1', 'Mixed doubles #2', "Men's doubles"] as const;

/** The games of a meeting, in the order the organiser scores them. */
type Rounds = readonly (readonly [number, number])[];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/**
 * Scores games of one meeting, oldest unscored game first.
 *
 * `card` must identify *this* meeting and nothing else: a scored game unmounts its own form, so
 * the number of forms left inside the card is what tells us the save landed. The word "Saved" will
 * not do — the page-top banner keeps the previous game's message up for eight seconds.
 *
 * A running game deliberately renders its form twice, in the Now playing box and on its meeting
 * card, so everything here is scoped to the card.
 */
async function playGames(card: Locator, rounds: Rounds, timeUp = false): Promise<void> {
  const forms = card.getByTestId('game-score-form');
  for (const [a, b] of rounds) {
    const before = await forms.count();
    const form = forms.first();
    await form.locator('input[name="scoreA"]').fill(String(a));
    await form.locator('input[name="scoreB"]').fill(String(b));
    if (timeUp) await form.locator('input[name="timeExpired"]').check();
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(forms).toHaveCount(before - 1);
  }
}

/** The open meeting between two named teams. */
function meetingCard(page: Page, a: string, b: string): Locator {
  return page.locator('div.rounded.border', { has: page.getByTestId('game-score-form') })
    .filter({ hasText: a }).filter({ hasText: b }).first();
}

/**
 * True when `a` is the meeting's side A. The score form names its inputs after the game and the
 * team ("Men's doubles · Alpha & Ana"), which is the only place the card states the orientation
 * unambiguously.
 */
async function aIsSideA(card: Locator, a: string): Promise<boolean> {
  const aria = await card.getByTestId('game-score-form').first().locator('input[name="scoreA"]').getAttribute('aria-label');
  return (aria ?? '').includes(a);
}

/**
 * Plays every game of the open meeting between two named teams, so that `a` wins it. All three
 * games are always played, so `a` takes games 1 and 2 and `b` takes game 3: the meeting goes to
 * `a` two games to one and its net points difference is exactly `sa - sb`, which is what the
 * standings below are engineered around.
 */
async function enterResult(page: Page, a: string, b: string, sa: number, sb: number, timeUp = false) {
  await page.goto(`/admin/${slug}/matches?filter=open`);
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
  await page.goto(`/admin/${slug}`);
  await page.fill('textarea[name="lines"]', teams.join('\n'));
  await page.getByRole('button', { name: 'Add teams' }).click();
  await expect(page.getByText('Added 4 team(s)')).toBeVisible();
  await page.goto(`/admin/${slug}/pools`);
  await page.fill('input[name="poolCount"]', '1');
  await page.getByRole('button', { name: /Generate pools|Re-deal/ }).click();
  await page.getByRole('button', { name: 'Lock pools and create matches' }).click();
  await expect(page.getByText('Pools locked and matches created')).toBeVisible();

  // A meeting is three labelled games, and every one of them is listed on its card.
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const anyCard = page.locator('div.rounded.border', { has: page.getByTestId('game-score-form') }).first();
  for (const label of GAME_LABELS) {
    await expect(anyCard.getByText(label, { exact: true })).toBeVisible();
  }

  // Start now on the first open game: it goes to a court of its own and the Now playing box at the
  // top of the screen picks it up, clock and all. The public live board shows the same box.
  await page.getByRole('button', { name: 'Start now' }).first().click();
  const nowPlaying = page.getByTestId('now-playing');
  await expect(nowPlaying.getByTestId('court-clock')).toBeVisible();
  await expect(nowPlaying.getByText(GAME_LABELS[0], { exact: true })).toBeVisible();
  await page.goto(`/t/${slug}`);
  await expect(page.getByTestId('now-playing').getByTestId('court-clock')).toHaveText(/\d\d:\d\d|TIME/);

  // Pause stops that game's clock; Resume starts it counting again. The clock belongs to the game,
  // so both controls live on the game's line inside the Now playing box.
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const playing = page.getByTestId('now-playing');
  await playing.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(playing.getByTestId('court-clock')).toHaveText(/\d\d:\d\d paused/);
  await playing.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(playing.getByTestId('court-clock')).toHaveText(/^\d\d:\d\d$/);

  // invalid single game 14-12 keeps Save disabled and shows the reason. Scoped to a meeting card,
  // because the game on court renders its form in the Now playing box as well.
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const first = page.locator('div.rounded.border', { has: page.getByTestId('game-score-form') })
    .first().getByTestId('game-score-form').first();
  await first.locator('input[name="scoreA"]').fill('14');
  await first.locator('input[name="scoreB"]').fill('12');
  await expect(first.getByText('winner must reach 15', { exact: true })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Save' })).toBeDisabled();

  // Two games to nil does not end a meeting: the third is always played, and only then does the
  // meeting leave the open list.
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const opener = meetingCard(page, 'Alpha & Ana', 'Bravo & Bea');
  const alphaFirst = await aIsSideA(opener, 'Alpha & Ana');
  const alphaWins: readonly [number, number] = alphaFirst ? [15, 9] : [9, 15];
  const bravoWins: readonly [number, number] = alphaFirst ? [9, 15] : [15, 9];
  await playGames(opener, [alphaWins, alphaWins]);
  await expect(opener).toHaveCount(1);
  await expect(opener.getByTestId('game-score-form')).toHaveCount(1);
  await playGames(opener, [bravoWins]);
  await expect(opener).toHaveCount(0);

  // results: A beats all by 6 on aggregate; B beats C, C beats D (time expired 10-4), D beats B.
  // B, C, D end on 1 point each with a circular head-to-head and identical -6 score difference.
  await enterResult(page, 'Alpha & Ana', 'Charlie & Cho', 15, 9);
  await enterResult(page, 'Alpha & Ana', 'Delta & Dee', 15, 9);
  await enterResult(page, 'Bravo & Bea', 'Charlie & Cho', 15, 9);
  await enterResult(page, 'Charlie & Cho', 'Delta & Dee', 10, 4, true);
  await enterResult(page, 'Delta & Dee', 'Bravo & Bea', 15, 9);
  await page.goto(`/admin/${slug}/matches?filter=open`);
  await expect(page.getByText('Nothing here.')).toBeVisible();

  // unresolved three-way tie touching the qualification line
  await page.goto(`/admin/${slug}/pools`);
  await expect(page.getByText(/tied for the last qualifying place|tie on the qualification line/i)).toBeVisible();
  // knockout refuses until resolved
  await page.goto(`/admin/${slug}/bracket`);
  await expect(page.getByText(/unresolved tie/i)).toBeVisible();

  // record a playoff between two of the tied teams. The form is prefilled with the first two names
  // in the tie group (Bravo and Charlie), which is what we want here.
  await page.goto(`/admin/${slug}/pools`);
  await page.getByRole('button', { name: /Record men.s doubles playoff/ }).click();
  await expect(page.getByText('Playoff created')).toBeVisible();
  // The playoff is a real meeting: it appears on the open list labelled "<pool> · playoff", and it
  // is three games like any other.
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const playoffCard = page.locator('div.rounded.border', { has: page.getByTestId('game-score-form') })
    .filter({ hasText: /playoff/i }).first();
  await expect(playoffCard).toBeVisible();
  await playGames(playoffCard, [[15, 9], [15, 9], [9, 15]]);
  await expect(playoffCard).toHaveCount(0);
  // The public pools page lists it under its own "Playoff" heading (inside the collapsed
  // "Matches (n/n played)" disclosure, which counts pool matches only).
  await page.goto(`/t/${slug}/pools`);
  await page.locator('summary').first().click();
  await expect(page.getByRole('heading', { name: 'Playoff' })).toBeVisible();
  // One playoff does not settle a three-way tie: poolStandings only uses a playoff to separate a
  // group of exactly two, so Bravo/Charlie/Delta are still level and the warning stands. The
  // manual order below is what actually resolves it.
  await page.goto(`/admin/${slug}/pools`);
  await expect(page.getByText(/tied for the last qualifying place|tie on the qualification line/i)).toBeVisible();

  // set the order manually: A, C, B, D
  await page.goto(`/admin/${slug}/pools`);
  const order = { 'Alpha & Ana': '1', 'Charlie & Cho': '2', 'Bravo & Bea': '3', 'Delta & Dee': '4' } as const;
  for (const [name, rank] of Object.entries(order)) {
    const row = page.locator('tr', { hasText: name }).first();
    await row.locator('select').selectOption(rank);
  }
  await page.getByRole('button', { name: 'Set finishing order' }).click();
  await expect(page.getByText('Order set by organiser')).toBeVisible();
  await page.goto(`/t/${slug}/pools`);
  await expect(page.getByText('Order set by organiser')).toBeVisible();
  await expect(page.locator('tr.bg-emerald-50')).toHaveCount(2);

  // start knockout (2 qualifiers -> a single final) and replace Charlie with Bravo in the final
  await page.goto(`/admin/${slug}/bracket`);
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
  await page.goto(`/admin/${slug}`);
  const bravoRow = page.locator('tr', { hasText: 'Bravo & Bea' });
  await bravoRow.getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.getByText(/withdrawn/i).first()).toBeVisible();
  await page.goto(`/t/${slug}/bracket`);
  await expect(page.getByText(/Champions: Alpha & Ana/)).toBeVisible();
  await expect(page.getByText(/forfeit/i).first()).toBeVisible();

  // override the done final: award it to Bravo (organiser decision) -> champion changes, label "awarded".
  // Alpha and Bravo also met in the pool, and pool matches sort first, so the card is pinned by its
  // knockout label ("Round 1 · #1") as well as by the two team names.
  await page.goto(`/admin/${slug}/matches?filter=done`);
  const finalCard = page.locator('div.rounded.border')
    .filter({ hasText: 'Round 1' }).filter({ hasText: 'Alpha & Ana' }).filter({ hasText: 'Bravo & Bea' }).first();
  await finalCard.getByRole('button', { name: 'Award to Bravo & Bea' }).click();
  await expect(page.getByText('Match awarded')).toBeVisible();
  await page.goto(`/t/${slug}/bracket`);
  await expect(page.getByText(/Champions: Bravo & Bea/)).toBeVisible();
  await expect(page.getByText(/awarded/i).first()).toBeVisible();
});

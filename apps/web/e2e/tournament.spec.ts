import { test, expect, type Locator, type Page } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const slug = `e2e-${Date.now().toString(36)}`;
const teams = ['Ann & Bo', 'Cy & Di', 'Ed & Flo', 'Gus & Hal', 'Ivy & Jo', 'Kim & Lu', 'Mo & Ned', 'Oz & Pia'];

/** The three games of a meeting, in the order the organiser scores them. */
type Rounds = readonly (readonly [number, number])[];

/**
 * Scores games of one meeting, oldest unscored game first.
 *
 * `card` must be a locator that identifies *this* meeting and nothing else: a scored game unmounts
 * its own form, so the count of forms still inside the card is what tells us the save landed.
 * Waiting on the word "Saved" would not: the page-top <RecentOutcome/> banner keeps the previous
 * game's message on screen for eight seconds, so the assertion would pass before the click.
 *
 * A running game deliberately renders its form twice — once in the Now playing box and once on its
 * own meeting card — so every locator here is scoped to the card.
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

/**
 * Plays every open meeting on the Matches screen until none remain, one meeting at a time.
 *
 * A meeting is three games and all three are always played, so side A takes games 1 and 2 and side
 * B takes game 3: the meeting goes to A two games to one, and A's net points difference over the
 * whole meeting is exactly the margin.
 *
 * The margin is the meeting's slot number (read off the card's label), so every meeting in a pool
 * is won by a different amount. A constant margin would not do: side A wins two of its three
 * round-robin meetings for three of the four teams in a pool, so identical margins leave those
 * three level on points *and* on score difference — a genuine unresolved tie across the
 * qualification line, which the bracket then correctly refuses to start.
 * Returns how many meetings were actually played, so callers can assert the expected count.
 */
async function playAllOpen(page: Page, slugName: string, max: number): Promise<number> {
  for (let i = 0; i < max; i++) {
    await page.goto(`/admin/${slugName}/matches?filter=open`);
    const open = page.locator('div.rounded.border', { has: page.getByTestId('game-score-form') });
    if ((await open.count()) === 0) return i;
    // The card label is "Pool A · #3" (or "Round 2 · #1" in the knockout); #n is the slot.
    const label = ((await open.first().locator('span').first().textContent()) ?? '').trim();
    const slot = Number(/#(\d+)/.exec(label)?.[1] ?? 6);
    // Pin the card by its label: a plain `.first()` would slide onto the *next* meeting the moment
    // this one is decided and drops off the open list, and the count assertions would never settle.
    const card = open.filter({ hasText: label }).first();
    await playGames(card, [[15, 15 - slot], [15, 15 - slot], [15 - slot, 15]]);
    await expect(card).toHaveCount(0);
  }
  return max;
}

test('an admin runs an 8-team tournament from setup to a champion', async ({ page }) => {
  // Destructive admin actions (re-entering a done result, removing a team) ask for confirmation.
  page.on('dialog', (d) => d.accept());

  // sign in
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // create tournament
  await page.fill('input[name="name"]', 'E2E Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));

  // settings: club defaults (three games to 15, 13-minute clock) — just save to prove the form works
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  // teams
  await page.fill('textarea[name="lines"]', teams.join('\n'));
  await page.getByRole('button', { name: 'Add teams' }).click();
  await expect(page.getByText('Added 8 team(s)')).toBeVisible();

  // pools: 2 pools of 4, lock
  await page.goto(`/admin/${slug}/pools`);
  await page.fill('input[name="poolCount"]', '2');
  await page.getByRole('button', { name: /Generate pools|Re-deal/ }).click();
  await expect(page.getByText('Pools generated')).toBeVisible();
  await page.getByRole('button', { name: 'Lock pools and create matches' }).click();
  await expect(page.getByText('Pools locked and matches created')).toBeVisible();

  // Put the first ready game on court: "Start now" with the court left on auto takes court 1. A
  // court holds one game now rather than a whole meeting, so what goes out is a single game, and
  // it appears in the Now playing box at the top of the organiser's screen.
  await page.goto(`/admin/${slug}/matches?filter=open`);
  await page.getByRole('button', { name: 'Start now' }).first().click();
  await expect(page.getByTestId('now-playing').getByText('Court 1')).toBeVisible();
  await page.goto(`/t/${slug}`);
  const publicNowPlaying = page.getByTestId('now-playing');
  await expect(publicNowPlaying.getByText('Court 1')).toBeVisible();
  // the club format gives every game its own 13-minute clock, so it counts down on the public board
  await expect(publicNowPlaying.getByTestId('court-clock')).toHaveText(/^\d\d:\d\d$/);

  // Invalid score is rejected: the club format wins by one, so an unfinished 14-12 is the rejection
  // to look for rather than a two-point-lead complaint. This is scoped to one meeting card because
  // the game on court renders its form here *and* in the Now playing box.
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const firstCard = page.locator('div.rounded.border', { has: page.getByTestId('game-score-form') }).first();
  const form = firstCard.getByTestId('game-score-form').first();
  await form.locator('input[name="scoreA"]').fill('14');
  await form.locator('input[name="scoreB"]').fill('12');
  await expect(form.getByText('winner must reach 15', { exact: true })).toBeVisible();
  // an unfinished score cannot be saved
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();

  // play all 12 pool meetings — three games each
  expect(await playAllOpen(page, slug, 12)).toBe(12);
  await page.goto(`/admin/${slug}/matches?filter=open`);
  await expect(page.getByText('Nothing here.')).toBeVisible();

  // public standings show two highlighted qualifiers per pool
  await page.goto(`/t/${slug}/pools`);
  await expect(page.locator('tr.bg-emerald-50')).toHaveCount(4);

  // start knockout (4 teams: two semis and a final)
  await page.goto(`/admin/${slug}/bracket`);
  await page.getByRole('button', { name: 'Start knockout with this bracket' }).click();
  await expect(page.getByText('Knockout started')).toBeVisible();
  await expect(page.getByText('Semi-finals')).toBeVisible();
  await expect(page.getByText('Final', { exact: true })).toBeVisible();

  // play semis and final
  expect(await playAllOpen(page, slug, 3)).toBe(3);

  // public bracket names a champion
  await page.goto(`/t/${slug}/bracket`);
  await expect(page.getByText(/Champions:/)).toBeVisible();
});

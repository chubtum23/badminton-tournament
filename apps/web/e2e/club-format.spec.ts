import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const slug = `club-${Date.now().toString(36)}`;
// One pool of 4 -> 6 matches; we engineer a 2nd/3rd tie: A beats everyone; B beats C; C beats D; D beats B.
const teams = ['Alpha & Ana', 'Bravo & Bea', 'Charlie & Cho', 'Delta & Dee'];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Enter a single-game result on the open match between two named teams. */
async function enterResult(page: Page, a: string, b: string, sa: number, sb: number, timeUp = false) {
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const card = page.locator('div.rounded.border', { has: page.getByTestId('score-form') }).filter({ hasText: a }).filter({ hasText: b }).first();
  const form = card.getByTestId('score-form');
  // The form's column order is teamA then teamB; find which is which from the header labels.
  const headers = await form.locator('span.font-medium').allTextContents();
  const aIsFirst = headers[0]?.includes(a);
  await form.locator('input[name="game1a"]').fill(String(aIsFirst ? sa : sb));
  await form.locator('input[name="game1b"]').fill(String(aIsFirst ? sb : sa));
  if (timeUp) await form.locator('input[name="game1x"]').check();
  await form.getByRole('button', { name: /save result/i }).click();
  // Inline while the card is mounted, in the page-top banner once the refresh unmounts it.
  await expect(page.getByText('Result saved').first()).toBeVisible();
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

  // Start now on the first open match: clock appears on the public live board
  await page.goto(`/admin/${slug}/matches?filter=open`);
  await page.getByRole('button', { name: 'Start now' }).first().click();
  await expect(page.getByTestId('court-clock').first()).toBeVisible();
  await page.goto(`/t/${slug}`);
  await expect(page.getByTestId('court-clock').first()).toHaveText(/\d\d:\d\d|TIME/);

  // invalid single game 14-12 keeps Save disabled and shows the reason
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const first = page.getByTestId('score-form').first();
  await first.locator('input[name="game1a"]').fill('14');
  await first.locator('input[name="game1b"]').fill('12');
  // The per-game hint reads exactly "winner must reach 15"; the match status line below repeats it
  // as "game 1: winner must reach 15", so `exact` is what keeps this to a single element.
  await expect(first.getByText('winner must reach 15', { exact: true })).toBeVisible();
  await expect(first.getByRole('button', { name: /save result/i })).toBeDisabled();

  // results: A beats all by 6; B beats C, C beats D (time expired 10-4), D beats B, each by 6.
  // B, C, D end on 1 point each with a circular head-to-head and identical -6 score difference.
  await enterResult(page, 'Alpha & Ana', 'Bravo & Bea', 15, 9);
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
  // The playoff is a real match: it appears on the open list labelled "<pool> · playoff".
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const playoffCard = page.locator('div.rounded.border', { has: page.getByTestId('score-form') })
    .filter({ hasText: /playoff/i }).first();
  await expect(playoffCard).toBeVisible();
  const playoffForm = playoffCard.getByTestId('score-form');
  await playoffForm.locator('input[name="game1a"]').fill('15');
  await playoffForm.locator('input[name="game1b"]').fill('9');
  await playoffForm.getByRole('button', { name: /save result/i }).click();
  await expect(page.getByText('Result saved').first()).toBeVisible();
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
  const finalCard = page.locator('div.rounded.border', { has: page.getByTestId('score-form') })
    .filter({ hasText: 'Round 1' }).filter({ hasText: 'Alpha & Ana' }).filter({ hasText: 'Bravo & Bea' }).first();
  await finalCard.getByRole('button', { name: 'Award to Bravo & Bea' }).click();
  await expect(page.getByText('Match awarded')).toBeVisible();
  await page.goto(`/t/${slug}/bracket`);
  await expect(page.getByText(/Champions: Bravo & Bea/)).toBeVisible();
  await expect(page.getByText(/awarded/i).first()).toBeVisible();
});

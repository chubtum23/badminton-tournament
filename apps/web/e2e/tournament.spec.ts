import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const slug = `e2e-${Date.now().toString(36)}`;
const teams = ['Ann & Bo', 'Cy & Di', 'Ed & Flo', 'Gus & Hal', 'Ivy & Jo', 'Kim & Lu', 'Mo & Ned', 'Oz & Pia'];

/**
 * Fill every open score form on the Matches screen with a win for side A until none remain. The
 * club format is a single game, so only game 1 exists on the form.
 * Returns how many results were actually entered, so callers can assert the expected count.
 */
async function playAllOpen(page: Page, slugName: string, max: number): Promise<number> {
  for (let i = 0; i < max; i++) {
    await page.goto(`/admin/${slugName}/matches?filter=open`);
    const form = page.getByTestId('score-form').first();
    if ((await form.count()) === 0) return i;
    await form.locator('input[name="game1a"]').fill('15');
    await form.locator('input[name="game1b"]').fill('7');
    await form.getByRole('button', { name: /save result|edit result/i }).click();
    // The form posts the action itself now, so the outcome lands inline instead of as a redirect.
    await expect(form.getByTestId('score-outcome')).toHaveText('Result saved');
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

  // settings: club defaults (one game to 15, 13-minute clock) — just save to prove the form works
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

  // put the first ready match on court: "Start now" with the court left on auto takes court 1
  await page.goto(`/admin/${slug}/matches?filter=open`);
  await page.getByRole('button', { name: 'Start now' }).first().click();
  await expect(page.getByText('On court')).toBeVisible();
  await page.goto(`/t/${slug}`);
  await expect(page.getByText('Court 1 · live')).toBeVisible();
  // the club format has a 13-minute clock, so a live match counts down on the public board
  await expect(page.getByTestId('court-clock').first()).toHaveText(/^\d\d:\d\d$/);

  // invalid score is rejected: the club format wins by one, so an unfinished 14-12 is the
  // rejection to look for rather than a two-point-lead complaint.
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const form = page.getByTestId('score-form').first();
  await form.locator('input[name="game1a"]').fill('14');
  await form.locator('input[name="game1b"]').fill('12');
  // Exact match: the per-game hint says "winner must reach 15" and the match status line now
  // repeats it as "game 1: winner must reach 15", so a substring match hits both.
  await expect(form.getByText('winner must reach 15', { exact: true })).toBeVisible();
  // an unfinished score cannot be saved
  await expect(form.getByRole('button', { name: /save result/i })).toBeDisabled();

  // play all 12 pool matches
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

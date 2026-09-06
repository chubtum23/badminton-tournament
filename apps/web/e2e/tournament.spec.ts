import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const slug = `e2e-${Date.now().toString(36)}`;
const teams = ['Ann & Bo', 'Cy & Di', 'Ed & Flo', 'Gus & Hal', 'Ivy & Jo', 'Kim & Lu', 'Mo & Ned', 'Oz & Pia'];

/**
 * Fill every open score form on the Matches screen with a 2-0 win for side A until none remain.
 * Returns how many results were actually entered, so callers can assert the expected count.
 */
async function playAllOpen(page: Page, slugName: string, max: number): Promise<number> {
  for (let i = 0; i < max; i++) {
    await page.goto(`/admin/${slugName}/matches?filter=open`);
    const form = page.getByTestId('score-form').first();
    if ((await form.count()) === 0) return i;
    await form.locator('input[name="game1a"]').fill('15');
    await form.locator('input[name="game1b"]').fill('7');
    await form.locator('input[name="game2a"]').fill('15');
    await form.locator('input[name="game2b"]').fill('9');
    await form.getByRole('button', { name: /save result|edit result/i }).click();
    await expect(page.getByText('Result saved')).toBeVisible();
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

  // settings: 2 courts, top 2 advance (defaults) — just save to prove the form works
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

  // court assignment on the first ready match
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const firstCourtForm = page.locator('form', { has: page.locator('select[name="court"]') }).first();
  await firstCourtForm.locator('select[name="court"]').selectOption('1');
  await firstCourtForm.getByRole('button', { name: 'Send to court' }).click();
  await expect(page.getByText('Court updated')).toBeVisible();
  await page.goto(`/t/${slug}`);
  await expect(page.getByText('Court 1 · live')).toBeVisible();

  // invalid score is rejected
  await page.goto(`/admin/${slug}/matches?filter=open`);
  const form = page.getByTestId('score-form').first();
  await form.locator('input[name="game1a"]').fill('15');
  await form.locator('input[name="game1b"]').fill('14');
  await expect(form.getByText('must win by two')).toBeVisible();

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

import { test, expect } from '@playwright/test';
import { addTeams, drawAndLock, fillScores, openFirstGame, playGames, signIn } from './helpers';

const slug = `relay-${Date.now().toString(36)}`;
// Two pools of two: a four-team knockout, so semi-finals and a final, both to 63.
const teams = ['Alpha & Ana', 'Bravo & Bea', 'Charlie & Cho', 'Delta & Dee'];

test('a relay knockout swaps pairs at each third and plays to the round target', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await signIn(page);
  await page.fill('input[name="name"]', 'Relay Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await addTeams(page, slug, teams);
  await drawAndLock(page, slug, 2);
  for (const pool of ['Pool A', 'Pool B']) {
    await page.goto(`/admin/${slug}/matches?pool=all`);
    await playGames(page.getByTestId('match-card').filter({ hasText: `${pool} · #1` }), [[15, 9], [15, 9], [9, 15]]);
  }

  // Relay rules: the default targets are 45 / 63 / 63.
  await page.goto(`/admin/${slug}/rules`);
  await page.locator('input[name="ko_relay"]').check();
  await expect(page.getByTestId('ko-relay').getByLabel('Semi-finals to')).toHaveValue('63');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByText('Rules saved')).toBeVisible();

  await page.goto(`/admin/${slug}/draw`);
  await page.getByRole('button', { name: 'Start knockout with this bracket' }).click();
  await expect(page.getByText('Knockout started')).toBeVisible();

  // Each semi is one relay game to 63.
  await page.goto(`/admin/${slug}/matches?pool=knockout`);
  const semi = page.getByTestId('match-card').filter({ hasText: 'Round 1 · #1' });
  await expect(semi.getByTestId('game-row')).toHaveCount(1);
  await expect(semi.getByTestId('game-row')).toContainText('Relay to 63');

  // Tap side A to 21 on the score sheet: the pairs swap there, and not before.
  const form = await openFirstGame(semi);
  await form.getByTestId('score-sheet-toggle').click();
  const pointA = form.getByRole('button', { name: /^\+ Point/ }).first();
  const leg = form.getByTestId('relay-leg');
  await expect(leg).toContainText('Leg 1 of 3');
  for (let i = 0; i < 20; i++) await pointA.click();
  await expect(leg).toContainText('swap when a team reaches 21');
  await pointA.click();
  await expect(leg).toContainText('Swap — Mixed doubles #2 on');
  await pointA.click();
  await expect(leg).toContainText('Leg 2 of 3');

  // A typed score has to reach the target exactly: 45 is not a finished semi, 63 is.
  await fillScores(form, 45, 40);
  await expect(form).toContainText('winner must reach 63');
  await fillScores(form, 63, 40);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(semi.getByTestId('game-row')).toHaveAttribute('data-scored', 'true');

  // The winner goes through to the final, a single relay game still waiting for the other semi.
  await page.goto(`/admin/${slug}/matches?pool=knockout`);
  await expect(page.getByTestId('match-card').filter({ hasText: 'Round 2 · #1' })).toContainText('0/1');
});

import { test, expect } from '@playwright/test';
import { addTeams, drawAndLock, openMeetings, playGames, playersOf, signIn } from './helpers';

const slug = `restart-${Date.now().toString(36)}`;
const teams = ['Alpha & Ana', 'Bravo & Bea'];

test('restart a game and a match, and keep and delete free score sheet games', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await signIn(page);
  await page.fill('input[name="name"]', 'Restart Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await addTeams(page, slug, teams);
  await drawAndLock(page, slug, 1);

  // A game started too early goes back to the full 13 minutes and stays on court.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  await page.getByRole('button', { name: 'Start', exact: true }).first().click();
  const playing = page.getByTestId('now-playing');
  await playing.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(playing.getByTestId('court-clock')).toHaveText(/paused/);
  await playing.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(playing.getByTestId('court-clock')).toHaveText(/^1[23]:\d\d$/);

  // Restart match wipes a scored game and takes the running one off court.
  const card = openMeetings(page).first();
  await playGames(card, [[15, 9]]);
  await expect(card.locator('[data-testid="game-row"][data-scored="true"]')).toHaveCount(1);
  await card.getByRole('button', { name: 'Restart match' }).click();
  await expect(page.getByText('Match restarted')).toBeVisible();
  await expect(page.locator('[data-testid="game-row"][data-scored="true"]')).toHaveCount(0);
  await expect(page.getByTestId('now-playing').getByTestId('court-clock')).toHaveCount(0);

  // The free score sheet: two games side by side, each with its own sides and score. A team fills
  // in its two men; Finish game moves a game to the history, and Delete there takes it out again.
  await page.goto(`/admin/${slug}/scoresheet`);
  await page.getByTestId('free-sheet-new').click();
  await page.getByTestId('free-sheet-new').click();
  const cards = page.getByTestId('free-game');
  await expect(cards).toHaveCount(2);
  const alpha = playersOf('Alpha & Ana');
  const first = cards.nth(0);
  const sideA = first.getByTestId('free-sheet-side-a');
  await expect(sideA.locator('select option').first()).toHaveText('Select team');
  await sideA.locator('select').selectOption({ label: 'Alpha & Ana' });
  await expect(sideA.locator('input').nth(0)).toHaveValue(alpha.mixed1);
  await expect(sideA.locator('input').nth(1)).toHaveValue(alpha.mixed2);
  await first.getByTestId('free-sheet-side-b').locator('select').selectOption({ label: 'Bravo & Bea' });
  // The second game scores on its own.
  const second = cards.nth(1);
  await second.getByRole('button', { name: '+ Point Side 2' }).click();
  await expect(second.getByTestId('free-game-summary')).toContainText('0–1');
  const point = first.getByRole('button', { name: '+ Point Alpha & Ana' });
  for (let i = 0; i < 15; i++) await point.click();
  await expect(first.getByText('Game over')).toBeVisible();
  await expect(second.getByTestId('free-game-summary')).toContainText('0–1');
  await first.getByTestId('free-game-finish').click();
  await expect(cards).toHaveCount(1);
  const history = page.getByTestId('free-sheet-history');
  await expect(history).toContainText('15–0');
  await expect(history).toContainText('Alpha & Ana won');
  // Still there after a refresh, and the game still going keeps its score.
  await page.reload();
  await expect(page.getByTestId('free-game')).toHaveCount(1);
  await expect(page.getByTestId('free-game-summary')).toContainText('0–1');
  await history.getByTestId('free-sheet-delete').click();
  await expect(history).toHaveCount(0);
  await page.getByTestId('free-game-delete').click();
  await expect(page.getByTestId('free-game')).toHaveCount(0);
});

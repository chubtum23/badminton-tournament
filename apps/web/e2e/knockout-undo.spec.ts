import { test, expect, type Page } from '@playwright/test';
import { addTeams, drawAndLock, openMeetings, playGames, signIn } from './helpers';

const slug = `ko-${Date.now().toString(36)}`;
// Two pools of two, both teams of each pool through: a four-team knockout.
const teams = ['Alpha & Ana', 'Bravo & Bea', 'Charlie & Cho', 'Delta & Dee'];

async function setKnockoutGames(page: Page, games: number) {
  await page.goto(`/admin/${slug}/rules`);
  const same = page.locator('input[name="ko_same"]');
  if (await same.isChecked()) await same.uncheck();
  await page.fill('input[name="ko_gamesPerMatch"]', String(games));
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByText('Rules saved')).toBeVisible();
}

async function startKnockout(page: Page) {
  await page.goto(`/admin/${slug}/draw`);
  await page.getByRole('button', { name: 'Start knockout with this bracket' }).click();
  await expect(page.getByText('Knockout started')).toBeVisible();
}

async function undo(page: Page) {
  await page.goto(`/admin/${slug}/draw`);
  const card = page.getByTestId('undo-knockout');
  await card.getByRole('button', { name: 'Undo knockout start' }).click();
  await card.getByRole('button', { name: 'Yes, undo the knockout' }).click();
  await expect(page.getByText(/Knockout undone/)).toBeVisible();
}

/** Pool results survive: both pool meetings are still on the Finished list. */
async function poolResultsIntact(page: Page) {
  await page.goto(`/admin/${slug}/matches?pool=all`);
  await expect(page.getByTestId('finished-count')).toHaveText('2');
}

test('knockout rules and draw stay changeable, and undoing the knockout keeps pool results', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await signIn(page);
  await page.fill('input[name="name"]', 'KO Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await addTeams(page, slug, teams);
  await drawAndLock(page, slug, 2);

  // Play both pool meetings.
  // Cards reorder as games are scored, so each meeting is found by its label, not its position.
  for (const pool of ['Pool A', 'Pool B']) {
    await page.goto(`/admin/${slug}/matches?pool=all`);
    await playGames(page.getByTestId('match-card').filter({ hasText: `${pool} · #1` }), [[15, 9], [15, 9], [9, 15]]);
  }
  await poolResultsIntact(page);

  // Knockout rules can still be changed after the pools: one game per knockout match.
  await setKnockoutGames(page, 1);

  // Pick who plays whom: swap the first two places in the draw.
  await page.goto(`/admin/${slug}/draw`);
  const seats = page.getByTestId('draw-seat');
  const second = await seats.nth(1).inputValue();
  await seats.nth(0).selectOption(second);
  await expect(seats.nth(0)).toHaveValue(second);
  await page.reload();
  await expect(page.getByTestId('draw-seat').nth(0)).toHaveValue(second);

  await startKnockout(page);
  await page.goto(`/admin/${slug}/matches?pool=knockout`);
  await expect(openMeetings(page).first().getByTestId('game-row')).toHaveCount(1);

  // Nothing played: undo, change the format to three games, start again.
  await undo(page);
  await poolResultsIntact(page);
  await page.goto(`/admin/${slug}/draw`);
  // The chosen draw is kept.
  await expect(page.getByTestId('draw-seat').nth(0)).toHaveValue(second);
  await setKnockoutGames(page, 3);
  await startKnockout(page);
  await page.goto(`/admin/${slug}/matches?pool=knockout`);
  const semi = page.getByTestId('match-card').filter({ hasText: 'Round 1 · #1' });
  await expect(semi.getByTestId('game-row')).toHaveCount(3);

  // Started but nothing played: the knockout rules still change, and the game slots follow them.
  await setKnockoutGames(page, 5);
  await page.goto(`/admin/${slug}/matches?pool=knockout`);
  await expect(semi.getByTestId('game-row')).toHaveCount(5);
  await setKnockoutGames(page, 3);
  await page.goto(`/admin/${slug}/matches?pool=knockout`);
  await expect(semi.getByTestId('game-row')).toHaveCount(3);
  await poolResultsIntact(page);

  // With a knockout game played, the knockout rules fix, undo still works (after the Yes) and pool
  // results are untouched.
  await page.goto(`/admin/${slug}/matches?pool=knockout`);
  await playGames(semi, [[15, 9]]);
  await page.goto(`/admin/${slug}/rules`);
  await expect(page.getByTestId('ko-rules').getByLabel('Games per match')).toBeDisabled();
  await undo(page);
  await poolResultsIntact(page);
  await page.goto(`/admin/${slug}/draw`);
  await expect(page.getByRole('button', { name: 'Start knockout with this bracket' })).toBeVisible();
});

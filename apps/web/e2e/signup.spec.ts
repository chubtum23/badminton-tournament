import { test, expect, type Page } from '@playwright/test';
import { drawAndLock, openMeetings, playersOf, signIn } from './helpers';

const slug = `signup-${Date.now().toString(36)}`;
const teams = ['Smashers', 'Net Ninjas', 'Drop Shots', 'Late Birds'];

/** Fills the public sign-up form for one team. Each box decides its player's gender and role. */
async function joinAs(page: Page, name: string, code?: string): Promise<void> {
  const p = playersOf(name);
  await page.goto(`/t/${slug}/join`);
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="mixed1"]', p.mixed1);
  await page.fill('input[name="mixed2"]', p.mixed2);
  await page.fill('input[name="woman"]', p.woman);
  if (code !== undefined) await page.fill('input[name="joinCode"]', code);
  await page.getByRole('button', { name: 'Sign our team up' }).click();
}

test('teams sign themselves up, the organiser locks, and every game names its pair', async ({ page, browser }) => {
  page.on('dialog', (d) => d.accept());
  await signIn(page);
  await page.fill('input[name="name"]', 'Sign-up Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await expect(page.getByTestId('tile-teams')).toContainText('0 signed up');

  // the organiser protects sign-ups with a code
  await page.goto(`/admin/${slug}/teams`);
  await page.fill('input[name="joinCode"]', 'club2026');
  await page.getByRole('button', { name: 'Save code' }).click();
  await expect(page.getByText('Join code saved')).toBeVisible();

  // A team signs itself up from its own browser: the wrong code is refused inline, the right one
  // lands on the team page with the private link shown once.
  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await joinAs(visitor, teams[0]!, 'wrong');
  await expect(visitor.getByTestId('signup-error')).toContainText('join code is not right');
  await joinAs(visitor, teams[0]!, 'club2026');
  await expect(visitor).toHaveURL(new RegExp(`/t/${slug}/team\\?welcome=1$`));
  await expect(visitor.getByTestId('welcome')).toContainText(`/t/${slug}/team/`);

  // the team swaps which of its men plays Mixed #1
  const smashers = playersOf(teams[0]!);
  await visitor.getByRole('button', { name: 'Swap which man plays Mixed #1' }).click();
  await expect(visitor.getByText('Mixed pairs swapped')).toBeVisible();
  await expect(visitor.locator('input[name="mixed1"]')).toHaveValue(smashers.mixed2);

  // a name already taken is refused, whatever its case
  await joinAs(visitor, teams[0]!.toLowerCase(), 'club2026');
  await expect(visitor.getByTestId('signup-error')).toContainText('already taken');

  // the remaining teams, each in its own context so the team cookies do not collide
  for (const name of teams.slice(1)) {
    const c = await browser.newContext();
    const p = await c.newPage();
    await joinAs(p, name, 'club2026');
    await expect(p.getByTestId('welcome')).toBeVisible();
    await c.close();
  }

  // the organiser sees four complete rosters and locks from the hub
  await page.goto(`/admin/${slug}`);
  await expect(page.getByTestId('tile-teams')).toContainText('4 signed up · 4 complete');
  await drawAndLock(page, slug, 1);

  // locking closes sign-ups and freezes every roster
  await visitor.goto(`/t/${slug}/join`);
  await expect(visitor.getByText('Sign-ups are closed: the draw has been made, so no more teams can join.')).toBeVisible();
  await visitor.goto(`/t/${slug}/team`);
  await expect(visitor.getByText("The draw is locked, so players can't change. Ask the organiser if someone is injured.")).toBeVisible();

  // every game row names the pair playing it, and the swap above is reflected in the order
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const card = openMeetings(page).filter({ hasText: teams[0]! }).first();
  const pairs = card.getByTestId('pair-names');
  await expect(pairs).toHaveCount(3);
  await expect(pairs.nth(0)).toContainText(`${smashers.mixed2} & ${smashers.woman}`);
  await expect(pairs.nth(1)).toContainText(`${smashers.mixed1} & ${smashers.woman}`);
  await expect(pairs.nth(2)).toContainText(`${smashers.mixed2} & ${smashers.mixed1}`);

  // the overall points table lists every team, whatever pool they are in
  await page.goto(`/admin/${slug}/standings`);
  await expect(page.getByTestId('leaderboard').locator('tbody tr')).toHaveCount(4);

  await ctx.close();
});

import { test, expect, type Page } from '@playwright/test';
import { addTeams, drawAndLock, fillScores, openFirstGame, openMeetings, playGames, signIn } from './helpers';

const slug = `e2e-${Date.now().toString(36)}`;
const teams = ['Ann & Bo', 'Cy & Di', 'Ed & Flo', 'Gus & Hal', 'Ivy & Jo', 'Kim & Lu', 'Mo & Ned', 'Oz & Pia'];

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
    await page.goto(`/admin/${slugName}/matches?pool=all`);
    const open = openMeetings(page);
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

  await signIn(page);

  // create tournament
  await page.fill('input[name="name"]', 'E2E Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));

  // the hub opens on its four-step checklist, with nothing done but the rules defaults
  await expect(page.getByTestId('tile-teams')).toContainText('0 signed up');
  await expect(page.getByTestId('tile-draw')).toContainText('Not drawn');

  // rules: club defaults (three games to 15, 13-minute clock) — just save to prove the form works.
  // Rules has no tab of its own, so saving hands the organiser back to the checklist they came
  // from rather than leaving them on the form with nowhere obvious to go.
  await page.goto(`/admin/${slug}/rules`);
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByTestId('tile-rules')).toBeVisible();
  await expect(page.getByText('Rules saved')).toBeVisible();

  // and the page offers a way back without saving at all
  await page.goto(`/admin/${slug}/rules`);
  await page.getByTestId('back-link').click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));

  // teams: eight of them, each with two men and one woman
  await addTeams(page, slug, teams);
  await page.goto(`/admin/${slug}`);
  await expect(page.getByTestId('tile-teams')).toContainText('8 signed up · 8 complete');

  // pools: 2 pools of 4, locked from the hub
  await drawAndLock(page, slug, 2);

  // Put the first ready game on court: "Start now" with the court left on auto takes court 1. A
  // court holds one game now rather than a whole meeting, so what goes out is a single game, and
  // it appears in the Now playing box at the top of the organiser's screen.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  await page.getByRole('button', { name: 'Start', exact: true }).first().click();
  await expect(page.getByTestId('now-playing').getByText('Court 1')).toBeVisible();
  await page.goto(`/t/${slug}`);
  const publicNowPlaying = page.getByTestId('now-playing');
  await expect(publicNowPlaying.getByText('Court 1')).toBeVisible();
  // the club format gives every game its own 13-minute clock, so it counts down on the public board
  await expect(publicNowPlaying.getByTestId('court-clock')).toHaveText(/^\d\d:\d\d$/);

  // Invalid score is rejected: the club format wins by one, so an unfinished 14-12 is the rejection
  // to look for rather than a two-point-lead complaint. This is scoped to one meeting card because
  // the game on court renders its form here *and* in the Now playing box.
  await page.goto(`/admin/${slug}/matches?pool=all`);
  const form = await openFirstGame(openMeetings(page).first());
  await fillScores(form, 14, 12);
  await expect(form.getByText('winner must reach 15', { exact: true })).toBeVisible();
  // an unfinished score cannot be saved
  await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled();

  // play all 12 pool meetings — three games each
  expect(await playAllOpen(page, slug, 12)).toBe(12);
  await page.goto(`/admin/${slug}/matches?pool=all`);
  await expect(page.getByText('Nothing waiting.')).toBeVisible();
  await expect(page.getByTestId('finished-count')).toHaveText('12');

  // public standings show two highlighted qualifiers per pool
  await page.goto(`/t/${slug}/pools`);
  await expect(page.locator('tr[data-qualifies]')).toHaveCount(4);

  // the organiser's Standings page ranks all eight teams in one table across both pools
  await page.goto(`/admin/${slug}/standings`);
  await expect(page.getByTestId('leaderboard').locator('tbody tr')).toHaveCount(8);

  // start knockout (4 teams: two semis and a final)
  await page.goto(`/admin/${slug}/draw`);
  await page.getByRole('button', { name: 'Start knockout with this bracket' }).click();
  await expect(page.getByText('Knockout started')).toBeVisible();
  // The draw page names each round four times — once in the narrow draw tree (hidden at this
  // viewport), once in each mirrored half of the wide one, and once in the bracket below — so the
  // round titles are read off the bracket rather than matched across the whole page.
  const bracket = page.getByTestId('bracket');
  await expect(bracket.getByText('Semi-finals')).toBeVisible();
  await expect(bracket.getByText('Final', { exact: true })).toBeVisible();

  // play semis and final
  expect(await playAllOpen(page, slug, 3)).toBe(3);

  // public bracket names a champion
  await page.goto(`/t/${slug}/bracket`);
  await expect(page.getByText(/Champions:/)).toBeVisible();
});

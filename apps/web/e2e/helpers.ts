import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Steps every spec needs. Playwright only collects `*.spec.ts`, so this file is a plain module.
 *
 * A team is three named players now, so adding one is a form rather than a line of text, and the
 * organiser's screens are split across a hub, Teams, Standings and Draw. Keeping those paths and
 * selectors here means a later rename is one edit rather than four.
 */

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';

export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** Three player names derived from the team name, so every team's players are distinguishable. */
export function playersOf(teamName: string): { mixed1: string; mixed2: string; woman: string } {
  const stem = teamName.replace(/[^A-Za-z]/g, '').slice(0, 6) || 'Team';
  return { mixed1: `${stem} One`, mixed2: `${stem} Two`, woman: `${stem} Ella` };
}

/**
 * Adds one team with its two men and one woman through the organiser's form.
 *
 * The page carries a roster form per existing team as well as this one, so the fields are reached
 * through the form that holds the "Add team" button rather than by name alone.
 */
export async function addTeam(page: Page, slug: string, teamName: string): Promise<void> {
  const p = playersOf(teamName);
  await page.goto(`/admin/${slug}/teams`);
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add team', exact: true }) });
  await form.locator('input[name="name"]').fill(teamName);
  await form.locator('input[name="mixed1"]').fill(p.mixed1);
  await form.locator('input[name="mixed2"]').fill(p.mixed2);
  await form.locator('input[name="woman"]').fill(p.woman);
  await form.getByRole('button', { name: 'Add team', exact: true }).click();
  await expect(page.getByText('Team added')).toBeVisible();
}

export async function addTeams(page: Page, slug: string, teamNames: readonly string[]): Promise<void> {
  for (const name of teamNames) await addTeam(page, slug, name);
}

/** One team's row on the Teams page, expanded so its controls and private link are clickable. */
export async function openTeamRow(page: Page, teamName: string): Promise<Locator> {
  const row = page.getByTestId('team-row').filter({ hasText: teamName }).first();
  const summary = row.locator('summary');
  // <details> keeps its children in the DOM when closed, but Playwright will not click what is not
  // visible, so the row is opened unless a previous step already opened it.
  if (!(await row.locator('details').first().evaluate((d) => (d as HTMLDetailsElement).open))) {
    await summary.click();
  }
  return row;
}

/** Draws `poolCount` pools on Standings, then locks from the hub, where the stage buttons live. */
export async function drawAndLock(page: Page, slug: string, poolCount: number): Promise<void> {
  await page.goto(`/admin/${slug}/standings`);
  await page.fill('input[name="poolCount"]', String(poolCount));
  await page.getByRole('button', { name: /Generate pools|Re-deal/ }).click();
  await expect(page.getByText('Pools generated')).toBeVisible();
  await page.goto(`/admin/${slug}`);
  await page.getByRole('button', { name: 'Lock pools and create matches' }).click();
  await expect(page.getByText('Pools locked and matches created')).toBeVisible();
}

/** Every meeting card with at least one game still to score, on the Matches screen. */
export function openMeetings(page: Page): Locator {
  return page.getByTestId('match-card').filter({ has: page.getByTestId('game-score-form') });
}

/** The open meeting between two named teams. */
export function meetingCard(page: Page, a: string, b: string): Locator {
  return openMeetings(page).filter({ hasText: a }).filter({ hasText: b }).first();
}

/** The games of a meeting, in the order the organiser scores them. */
export type Rounds = readonly (readonly [number, number])[];

/**
 * Scores games of one meeting, oldest unscored game first.
 *
 * `card` must identify *this* meeting and nothing else: a scored game unmounts its own form, so the
 * count of forms still inside the card is what tells us the save landed. Waiting on the word
 * "Saved" would not — the page-top banner keeps the previous game's message up for eight seconds.
 *
 * A running game deliberately renders its form twice, in the Now playing box and on its meeting
 * card, so every locator here is scoped to the card.
 */
export async function playGames(card: Locator, rounds: Rounds, timeUp = false): Promise<void> {
  const forms = card.getByTestId('game-score-form');
  for (const [a, b] of rounds) {
    const before = await forms.count();
    const form = forms.first();
    await fillScores(form, a, b);
    if (timeUp) await form.locator('input[name="timeExpired"]').check();
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(forms).toHaveCount(before - 1);
  }
}

/**
 * Types both scores into one game's form and confirms they stuck.
 *
 * The score form is a client component that validates as you type. A `fill` that lands between the
 * server's first paint and React attaching to it sets the DOM value but not the component's state,
 * and hydration then puts the empty default back — leaving a half-filled form that shows no
 * validation message and never enables Save. Retrying until the value survives is what makes the
 * step deterministic rather than a race against compile time on a cold route.
 */
export async function fillScores(form: Locator, a: number, b: number): Promise<void> {
  const scoreA = form.locator('input[name="scoreA"]');
  const scoreB = form.locator('input[name="scoreB"]');
  await expect(async () => {
    await scoreA.fill(String(a));
    await scoreB.fill(String(b));
    await expect(scoreA).toHaveValue(String(a), { timeout: 1000 });
    await expect(scoreB).toHaveValue(String(b), { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * True when `a` is the meeting's side A. The score form names its inputs after the game and the
 * team ("Men's doubles · Alpha & Ana"), which is the only place the card states the orientation
 * unambiguously.
 */
export async function aIsSideA(card: Locator, a: string): Promise<boolean> {
  const aria = await card.getByTestId('game-score-form').first().locator('input[name="scoreA"]').getAttribute('aria-label');
  return (aria ?? '').includes(a);
}

import { test, expect, type Page, type Browser } from '@playwright/test';
import { addTeams, drawAndLock, openTeamRow, signIn } from './helpers';

const slug = `p2p-${Date.now().toString(36)}`;
const teams = ['Ann & Bo', 'Cy & Di', 'Ed & Flo', 'Gus & Hal'];

/**
 * Fills the first score form and submits it, then asserts the inline outcome. Unlike the organiser,
 * who scores one game at a time, a participant reports the whole meeting at once — and a meeting is
 * three games, all of which are always played, so all three rows have to be filled before the form
 * will submit. The reported meeting goes to side A two games to one: `a` wins games 1 and 2, and
 * game 3 is the same score the other way round.
 *
 * There is no redirect any more: the form calls the action itself and the server-chosen text lands
 * inline in [data-testid="score-outcome"] and, for when the refresh unmounts the card, in the
 * page-top [data-testid="score-outcome-banner"].
 */
async function submitScores(page: Page, a: [number, number], expected: RegExp) {
  const form = page.getByTestId('score-form').first();
  const rounds: [number, number][] = [a, a, [a[1], a[0]]];
  for (const [n, [x, y]] of rounds.entries()) {
    await form.locator(`input[name="game${n + 1}a"]`).fill(String(x));
    await form.locator(`input[name="game${n + 1}b"]`).fill(String(y));
  }
  await form.getByRole('button', { name: 'Submit scores' }).click();
  // The message shows inline while the card is mounted and, after the refresh unmounts it, in the
  // page-top banner; either location satisfies this.
  await expect(page.getByText(expected).first()).toBeVisible();
}

/** Opens a team's private link in a fresh browser context and returns the page on /t/[slug]/team. */
async function openAsTeam(browser: Browser, link: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(link);
  await expect(page).toHaveURL(new RegExp(`/t/${slug}/team$`));
  return page;
}

test('participants submit, confirm and dispute scores; admins resolve and announce', async ({ page, browser }) => {
  page.on('dialog', (d) => d.accept());

  // admin: sign in, create, add 4 teams, one pool, lock
  await signIn(page);
  await page.fill('input[name="name"]', 'Participant Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  // The next step navigates straight to Teams, so the create has to have landed first: leaving
  // early cancels it, and Teams then bounces to /login for a tournament that never existed.
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
  await addTeams(page, slug, teams);

  // collect the private links from the Teams page: each row expands to its own <code>link</code>
  const links: Record<string, string> = {};
  for (const name of teams) {
    const row = await openTeamRow(page, name);
    links[name] = ((await row.locator('code').first().textContent()) ?? '').trim();
    expect(links[name]).toMatch(new RegExp(`/t/${slug}/team/[A-Za-z0-9_-]{24}$`));
  }

  await drawAndLock(page, slug, 1);

  // admin posts a pinned announcement
  await page.goto(`/admin/${slug}/announcements`);
  await page.fill('textarea[name="body"]', 'Courts open at 7pm. Bring your own shuttles.');
  await page.check('input[name="pinned"]');
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText('Posted')).toBeVisible();

  // public live page shows the banner and the realtime pill
  await page.goto(`/t/${slug}`);
  // The header banner repeats a new announcement, so look for the pinned card in the page body.
  await expect(page.getByRole('main').getByText('Courts open at 7pm')).toBeVisible();
  await expect(page.getByTestId('realtime-status')).toHaveText(/live/, { timeout: 15000 });

  // an invalid token is refused with a redirect to the team page's own explanation, not a cookie
  const badRes = await page.request.get(`/t/${slug}/team/000000000000000000000000`, { maxRedirects: 0 });
  expect(badRes.status()).toBe(303);
  expect(badRes.headers()['location']).toContain(`/t/${slug}/team?link=invalid`);
  expect(badRes.headers()['set-cookie']).toBeUndefined();

  // team Ann & Bo opens its link, renames itself
  const ann = await openAsTeam(browser, links['Ann & Bo']!);
  await ann.fill('input[name="name"]', 'The Smashers');
  await ann.getByRole('button', { name: 'Save team' }).click();
  await expect(ann.getByText('Team updated')).toBeVisible();
  await page.goto(`/t/${slug}/pools`);
  await expect(page.getByText('The Smashers').first()).toBeVisible();

  // find Ann's round-0 opponent from the "Your next match" card and open that team's link. In a
  // single-pool round robin, round 0 pairs every team exactly once, so this match is
  // simultaneously each side's own earliest unplayed match (see decideSubmission/team page.tsx:
  // a team's "next" match is whichever of its own matches has the smallest slot number and is not
  // yet done; round 0 is the one round guaranteed to be that for both participants at once).
  const nextCard = ann.locator('section', { hasText: 'Your next match' }).getByTestId('match-card').first();
  const cardText = (await nextCard.textContent()) ?? '';
  const opponentName = teams.find((n) => n !== 'Ann & Bo' && cardText.includes(n))!;
  const opp = await openAsTeam(browser, links[opponentName]!);

  // Ann submits 15-7; opponent submits the same -> confirmed (done)
  await submitScores(ann, [15, 7], /Scores submitted, waiting for the other team/);
  // the opponent's team page shows Ann's scores tagged unconfirmed (a submitted match is not
  // "live" or "up next", so it does not appear on the public Live page until it is done)
  await opp.goto(`/t/${slug}/team`);
  await expect(opp.getByText(/unconfirmed/i).first()).toBeVisible();
  await submitScores(opp, [15, 7], /Result confirmed/);

  // second match: the OTHER round-0 pairing submits different scores -> disputed. Ann's own
  // second match can't be used for this: participants can only act on their own current "next"
  // match, and after round 0 a team's next is whichever of its own remaining matches has the
  // smallest slot number, which is generally NOT its opponent's own next until every
  // earlier-numbered match on either side has been played. Round 0 is the only round where every
  // team's earliest match is guaranteed to be its shared match with its round-0 partner, and with
  // 4 teams round 0 has exactly two pairings (Ann's, used above, and this one) covering everyone,
  // so this pairing is deterministic without playing any extra match.
  const others = teams.filter((n) => n !== 'Ann & Bo' && n !== opponentName);
  const teamC = await openAsTeam(browser, links[others[0]!]!);
  const teamD = await openAsTeam(browser, links[others[1]!]!);
  await submitScores(teamC, [15, 3], /Scores submitted, waiting for the other team/);
  await submitScores(teamD, [15, 5], /Scores differ from the other team/);

  // admin sees it in Needs attention and confirms teamC's version
  await page.goto(`/admin/${slug}/matches?pool=all`);
  await expect(page.getByTestId('attention-count')).toHaveText('1');
  // Scope to the SubmissionCompare cell itself: the surrounding match card contains the same
  // text and button, so an unscoped selector resolves to two elements (a strict-mode violation).
  const cCell = page.getByTestId('submission-cell').filter({ hasText: `${others[0]} says` });
  await cCell.getByRole('button', { name: 'Confirm this' }).click();
  await expect(page.getByText('Result confirmed')).toBeVisible();
  await expect(page.getByText(/Needs attention/)).toHaveCount(0);

  // public pools page shows two played matches for Ann's team
  await page.goto(`/t/${slug}/pools`);
  await expect(page.getByText(/2\/6 played/)).toBeVisible();
});

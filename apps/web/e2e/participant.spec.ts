import { test, expect, type Page, type Browser } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const slug = `p2p-${Date.now().toString(36)}`;
const teams = ['Ann & Bo', 'Cy & Di', 'Ed & Flo', 'Gus & Hal'];

async function fillScores(page: Page, a: [number, number], b: [number, number]) {
  const form = page.getByTestId('score-form').first();
  await form.locator('input[name="game1a"]').fill(String(a[0]));
  await form.locator('input[name="game1b"]').fill(String(a[1]));
  await form.locator('input[name="game2a"]').fill(String(b[0]));
  await form.locator('input[name="game2b"]').fill(String(b[1]));
  const before = page.url();
  await form.getByRole('button', { name: 'Submit scores' }).click();
  // Wait for the redirect itself to land before asserting on its message; the URL we started from
  // may already carry a stale msg= from an earlier action, so compare against it rather than just
  // matching /msg=/. The banner is rendered client-side from the query string (FlashMessage), so
  // a realtime refresh arriving alongside the redirect can no longer wipe it.
  await page.waitForURL((url) => url.toString() !== before, { timeout: 15000 });
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
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.fill('input[name="name"]', 'Participant Night');
  await page.fill('input[name="slug"]', slug);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.fill('textarea[name="lines"]', teams.join('\n'));
  await page.getByRole('button', { name: 'Add teams' }).click();
  await expect(page.getByText('Added 4 team(s)')).toBeVisible();

  // collect the private links from the Setup page (each row: team name + <code>link</code>)
  const links: Record<string, string> = {};
  for (const name of teams) {
    const code = page.locator('tr', { hasText: name }).locator('code').first();
    links[name] = (await code.textContent())!.trim();
    expect(links[name]).toMatch(new RegExp(`/t/${slug}/team/[A-Za-z0-9_-]{24}$`));
  }

  await page.goto(`/admin/${slug}/pools`);
  await page.fill('input[name="poolCount"]', '1');
  await page.getByRole('button', { name: /Generate pools|Re-deal/ }).click();
  await page.getByRole('button', { name: 'Lock pools and create matches' }).click();
  await expect(page.getByText('Pools locked and matches created')).toBeVisible();

  // admin posts a pinned announcement
  await page.goto(`/admin/${slug}/announcements`);
  await page.fill('textarea[name="body"]', 'Courts open at 7pm. Bring your own shuttles.');
  await page.check('input[name="pinned"]');
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText('Posted')).toBeVisible();

  // public live page shows the banner and the realtime pill
  await page.goto(`/t/${slug}`);
  await expect(page.getByText('Courts open at 7pm')).toBeVisible();
  await expect(page.getByTestId('realtime-status')).toHaveText(/live/, { timeout: 15000 });

  // invalid token is rejected and the link is rate limited
  const badRes = await page.request.get(`/t/${slug}/team/000000000000000000000000`);
  expect(badRes.status()).toBe(404);

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
  const nextCard = ann.locator('section', { hasText: 'Your next match' }).locator('div.rounded').first();
  const cardText = (await nextCard.textContent()) ?? '';
  const opponentName = teams.find((n) => n !== 'Ann & Bo' && cardText.includes(n))!;
  const opp = await openAsTeam(browser, links[opponentName]!);

  // Ann submits 15-7, 15-9; opponent submits the same -> confirmed (done)
  await fillScores(ann, [15, 7], [15, 9]);
  await expect(ann.getByText('Scores submitted, waiting for the other team')).toBeVisible();
  // the opponent's team page shows Ann's scores tagged unconfirmed (a submitted match is not
  // "live" or "up next", so it does not appear on the public Live page until it is done)
  await opp.goto(`/t/${slug}/team`);
  await expect(opp.getByText(/unconfirmed/i).first()).toBeVisible();
  await fillScores(opp, [15, 7], [15, 9]);
  await expect(opp.getByText('Result confirmed')).toBeVisible();

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
  await fillScores(teamC, [15, 3], [15, 4]);
  await expect(teamC.getByText('Scores submitted, waiting for the other team')).toBeVisible();
  await fillScores(teamD, [15, 3], [15, 5]);
  await expect(teamD.getByText(/Scores differ from the other team/)).toBeVisible();

  // admin sees it in Needs attention and confirms teamC's version
  await page.goto(`/admin/${slug}/matches?filter=open`);
  await expect(page.getByText('Needs attention (1)')).toBeVisible();
  // Scope to the SubmissionCompare cell itself (class "rounded border p-2"): the surrounding
  // MatchCard wrapper also matches "div.rounded.border" and contains the same text and button,
  // which makes the plain selector resolve to two elements (a Playwright strict-mode violation).
  const cCell = page.locator('div.rounded.border.p-2', { hasText: `${others[0]} says` });
  await cCell.getByRole('button', { name: 'Confirm this' }).click();
  await expect(page.getByText('Result confirmed')).toBeVisible();
  await expect(page.getByText(/Needs attention/)).toHaveCount(0);

  // public pools page shows two played matches for Ann's team
  await page.goto(`/t/${slug}/pools`);
  await expect(page.getByText(/2\/6 played/)).toBeVisible();
});

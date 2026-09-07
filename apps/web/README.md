# @tournament/web

Next.js app for running and following a tournament. Rules come from `@tournament/core`.

## Local development

1. Start Docker Desktop, then from the repo root: `npx supabase start` and `npx supabase db reset`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and paste the values from `npx supabase status`.
3. `npm run seed:admin -w @tournament/web` creates `admin@local.test` / `local-admin-pass`.
4. `npm run dev -w @tournament/web`, sign in at `/login`, create a tournament at `/admin`.

## Formats

A new tournament starts on the club-night format: one game to 15, win by one, no point
cap, a 13-minute clock, 4 courts, top 2 per pool. Settings are **per stage** — the pool
stage and the knockout each have their own games per match, points per game, point cap,
clock and win-by-two, with "same as the pool stage" ticked by default on the knockout.
Rules lock when the pools do; the date and venue stay editable afterwards and show under
the tournament name on every public page.

**The clock.** A stage with `timeCapMinutes` set counts down from the moment a match goes
to court ("Start now", optionally onto a chosen court). The end time is derived from
`started_at`, so the admin match card, the live board and the bracket all show the same
countdown without anything being written per tick; it turns red and reads `TIME` at zero.
When the clock ends a game, tick **Time up** on the score form: a time-expired game is
accepted at any non-level score up to the point ceiling (so `10-4` stands), but a level
score is still rejected — the deciding point is played out on court.

**Entering results.** The score form validates as you type and says why a score is not
legal ("winner must reach 15") next to the game, keeping Save disabled until the match is
complete. It calls the server action itself, so a rejected save never loses typed scores
and the outcome lands inline instead of as a redirect.

**Standings and ties.** Pool tables are ordered by team points (one per win), then by a
recorded playoff between the tied teams, then head-to-head (two teams only), then score
difference, and finally name order — a position settled only by name is flagged `tie`.
Ties that span the qualification line (or decide first place) are called out above the
table, and the knockout refuses to start while one is unresolved.

**Resolving a tie.** Either record a playoff — "Record men's doubles playoff" creates a
match between the two teams, played on the Matches page, and it counts as a tie-breaker
without counting towards played/points/score — or set the finishing order by hand: pick a
place for every team in the standings table and press "Set finishing order". A manual
order wins outright, silences the tie flags and is labelled "Order set by organiser" to
the public. "Clear manual order" puts the computed table back.

**Awards, forfeits and withdrawals.** Any match with two known teams can be handed to one
side without a score ("Award to <team>"), including one already played — later matches
that depended on it are reset. Withdrawing a team forfeits every open match of theirs to
the opponent (matches still waiting on an opponent are left alone); reinstating clears the
flag but leaves forfeits standing. Every match records how it was decided — `played`,
`awarded` or `forfeit` — and the label shows on the card and in the bracket.

**Replacing a team in the bracket.** A withdrawal or a corrected pool table can leave the
wrong team in an unplayed knockout slot. "Replace a team" on the admin Bracket page swaps
one side of any knockout match that is not done yet, without touching anything played.

## Participants

Each team gets a private link, `/t/<slug>/team/<token>`, shown (and regeneratable) next
to the team on the admin Setup page. Opening it sets an httpOnly cookie scoped to the
tournament and redirects to `/t/<slug>/team`, so the token itself never sits in the
browser URL after the first visit. From there a participant can rename their team, set
a tagline and colour, and submit game scores for their own current match; a matching
opponent submission confirms the result automatically, a mismatch is flagged
"unconfirmed" until an admin resolves it. Every resolution of a team token — the one-time
link and each later request that presents the cookie — is rate limited to 30 per minute
per client (in-memory, so this only holds on a single server instance). Only *failed*
lookups spend that budget: guessing a token is a stream of misses, while a team holding a
valid link re-resolves its cookie on every render and realtime pushes several a minute.
The client is
identified from `x-real-ip` when a trusted proxy sets it (Vercel does), otherwise from
the LAST entry of `x-forwarded-for`, which is the only entry a client cannot forge.
Public pages, including the participant's, refresh via a Supabase realtime channel per
tournament; the `games` and `score_submissions` subscriptions are unfiltered by
tournament, which is acceptable for v1 since they only trigger a refetch. Team profile
edits are deliberately not pushed live: `teams` is outside the realtime publication, so
a renamed team appears on other people's screens at their next refresh.

## Tests

- `npm test -w @tournament/web`: unit tests, plus RLS integration tests when `.env.local` exists.
- `npm run e2e -w @tournament/web`: Playwright runs three specs against port 3100 — an
  8-team tournament through the admin UI; a participant flow covering private links,
  profile edits, a player-submitted match, a disputed match resolved by an admin, and
  announcements; and a club-night format run covering the date and venue on the public
  header, the court clock, a time-expired result, an invalid score blocked with its
  reason, a three-way tie on the qualification line resolved by a manual finishing order,
  a team replaced in a bracket slot, a withdrawal forfeiting the final, and an awarded
  match changing the champion.

## Routes

Public: `/t/[slug]` (live board), `/t/[slug]/pools`, `/t/[slug]/bracket`.
Participant: `/t/[slug]/team/[token]` (one-time link), `/t/[slug]/team` (after the cookie is set).
Admin: `/login`, `/admin`, `/admin/[slug]` (setup), `/admin/[slug]/pools`, `/admin/[slug]/matches`, `/admin/[slug]/bracket`, `/admin/[slug]/announcements`.

## Deploying

Create a hosted Supabase project, run `npx supabase db push` against it, set the three env vars on Vercel, deploy `apps/web` with root directory `apps/web` and build command `npm run build`. Not automated in this repo.

# @tournament/web

Next.js app for running and following a tournament. Rules come from `@tournament/core`.

## Local development

1. Start Docker Desktop, then from the repo root: `npx supabase start` and `npx supabase db reset`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and paste the values from `npx supabase status`.
3. `npm run seed:admin -w @tournament/web` creates `admin@local.test` / `local-admin-pass`.
4. `npm run dev -w @tournament/web`, sign in at `/login`, create a tournament at `/admin`.

## Meetings and games

A **meeting** between two teams is **three games**, each with its own name. A new
tournament starts on `Mixed doubles #1`, `Mixed doubles #2` and `Men's doubles`; the names
are editable on the admin Setup page, one per game.

**All three games are always played**, even when one team is already two games to nil. The
meeting is not over until its last game is scored, and it then goes to whoever won more of
them — one team point, with every game's score counted in the pool table's points
difference. (An odd number of games per meeting is required, so a meeting can never be
drawn.)

**Scores go in one game at a time.** Each game on a meeting card has its own small form:
two scores, a **Time up** box when the stage has a clock, and **Save**. There is no
whole-meeting score form for the organiser any more. A saved game can be reopened with
**Change** or rubbed out with **Clear**; changing a game on a meeting that already has a
result asks for confirmation first, because any later match that depended on it is reset.

**A court holds one game, not a meeting.** Each game is sent out on its own with **Start
now** (leave the court on "first free" or pick one), gets its own 13-minute countdown, and
comes back with **Take off court**. The three games of a meeting can therefore be on three
different courts at once, or spread across the evening. Saving a game's score takes it off
its court automatically.

**Now playing.** The admin Matches screen and the public live page both open with a **Now
playing** box above everything else, listing the games on court right now — the meeting's
two teams, the game's name, its court and its clock — ordered by court number. The
organiser's copy carries the same per-game controls as the meeting card, so the game on
court can be paused, taken off or scored without scrolling to find its meeting.

## Formats

A new tournament starts on the club-night format: three games to 15, win by one, no point
cap, every game played, a 13-minute clock, 4 courts, top 2 per pool. Settings are **per stage** — the pool
stage and the knockout each have their own games per match, points per game, point cap,
clock and win-by-two, with "same as the pool stage" ticked by default on the knockout.
Rules lock when the pools do; the date and venue stay editable afterwards and show under
the tournament name on every public page.

**The clock.** A stage with `timeCapMinutes` set counts down from the moment a **game** goes
to court ("Start now", optionally onto a chosen court). The end time is derived from that
game's `started_at`, so the Now playing box, the meeting card and the public board all show
the same countdown without anything being written per tick; it turns red and reads `TIME`
at zero. **Pause** freezes it and **Resume** starts it again, crediting the whole stoppage
back to the game rather than rewinding the clock, so a stoppage never eats into the cap; a
paused clock reads `09:41 paused`. When the clock ends a game, tick **Time up** on that
game's score form: a time-expired game is accepted at any non-level score up to the point
ceiling (so `10-4` stands), but a level score is still rejected — the deciding point is
played out on court.

**Entering results.** The score form validates as you type and says why a score is not
legal ("winner must reach 15") next to the game, keeping Save disabled until that game is
complete. It calls the server action itself, so a rejected save never loses typed scores
and the outcome lands inline instead of as a redirect. The confirmation also appears as a
banner at the top of the page, because saving a match usually drops its card out of the
"open" list and takes the inline message with it. Dates and times are rendered in the
server's timezone for now, not the viewer's.

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
a tagline and colour, and submit scores for their own current meeting. Participants report
the **whole meeting at once** — all three games on one form — unlike the organiser, who
scores a game at a time as each one comes off court; a matching
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
  8-team tournament through the admin UI, played meeting by meeting, three games at a time;
  a participant flow covering private links, profile edits, a player-submitted meeting, a
  disputed meeting resolved by an admin, and announcements; and a club-night format run
  covering the date and venue on the public header, the three game names on a meeting card,
  a game sent to a court with its clock in the Now playing box, that clock paused and
  resumed, a time-expired result, an invalid score blocked with its reason, a meeting still
  open at two games to nil and closing on the third, a three-way tie on the qualification
  line narrowed by a recorded playoff and then resolved by a manual finishing order, a team
  replaced in a bracket slot, a withdrawal forfeiting the final, and an awarded match
  changing the champion.
  Each spec now enters three times as many scores as it used to, so the per-test timeout in
  `playwright.config.ts` is 480s; the whole suite takes roughly eight minutes.

## Routes

Public: `/t/[slug]` (live board), `/t/[slug]/pools`, `/t/[slug]/bracket`.
Participant: `/t/[slug]/team/[token]` (one-time link), `/t/[slug]/team` (after the cookie is set).
Admin: `/login`, `/admin`, `/admin/[slug]` (setup), `/admin/[slug]/pools`, `/admin/[slug]/matches`, `/admin/[slug]/bracket`, `/admin/[slug]/announcements`.

## Previewing

`npm run dev -w @tournament/web` compiles each page the first time you open it, so the first
click on a screen feels slow. To see what a real visitor gets, build once and serve it:

```bash
npm run build -w @tournament/web
npm run start -w @tournament/web
```

Both need Docker Desktop and `npx supabase start`, and both are reachable only from this
machine.

## Deploying

See [docs/DEPLOY.md](../../docs/DEPLOY.md) for the full walkthrough: GitHub, a hosted Supabase
project (`npx supabase db push`), and Vercel with the three environment variables. The
committed `vercel.json` at the repo root carries the monorepo build settings.

# @tournament/web

Next.js app for running and following a tournament. Rules come from `@tournament/core`.

## Local development

1. Start Docker Desktop, then from the repo root: `npx supabase start` and `npx supabase db reset`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and paste the values from `npx supabase status`.
3. `npm run seed:admin -w @tournament/web` creates `admin@local.test` / `local-admin-pass`.
4. `npm run dev -w @tournament/web`, sign in at `/login`, create a tournament at `/admin`.
5. Share `/t/<slug>/join` and teams sign themselves up.

## Teams and sign-up

A team is **exactly three players: two men and one woman**. One person signs the whole team
up at `/t/<slug>/join` — a team name, an optional tagline, colour and description, and three
player boxes labelled **Man playing Mixed #1**, **Man playing Mixed #2** and **Woman**. Nobody
types a gender: the box a name goes in decides both the player's gender and the game they
play, so the woman partners a different man in each mixed game and the two men play the men's
doubles together. Signing up lands on the team's own page with its private link shown once.

Sign-ups are open from the moment a tournament is created and **close automatically when the
pools lock**; the organiser can also close and reopen them by hand on the Teams page, and set
an optional **join code** (3–30 characters, compared case-insensitively) so a forwarded link
alone is not enough. The code is never sent to the browser: the join page asks the database
whether one is set, and only an organiser can read its value.

A team edits its own players, and swaps which man plays Mixed #1, until the pools lock. The
organiser can add a team by hand with the same three boxes, rewrite any roster, and see an
**Incomplete roster** badge on a team that does not have two men and one woman. **Locking the
pools refuses** while any such team is in the draw, and names the offending teams.

## Meetings and games

A **meeting** between two teams is **three games**, each with its own name. A new
tournament starts on `Mixed doubles #1`, `Mixed doubles #2` and `Men's doubles`; the names
are editable on the admin Rules page, one per game. Which pair plays a game is fixed by the
game's **number**, not its name — game 1 is the Mixed #1 pair, game 2 the Mixed #2 pair, and
game 3 (or any later one) the two men — so renaming a game changes nothing. Every game row on
every screen names the two pairs actually playing it.

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

## Organiser screens

The admin area opens on a **hub** at `/admin/[slug]`: a four-step checklist — Event details,
Rules, Teams, Pools and draw — each a tile showing a one-line summary and a Done, To do or
Locked pill, and each opening one focused page. The stage buttons live under the tiles:
**Lock pools and create matches** while in setup (disabled, with the reason, until the teams
and the draw are ready), then **Start the knockout** and **Unlock pools**.

The nav is **Home · Teams · Matches · Standings · Draw · Announcements**, and the header
carries a status line such as `Setup · 6 teams signed up` or `Pool stage · 3 games on court`.
`/admin/[slug]/pools` and `/admin/[slug]/bracket` redirect to Standings and Draw.

**Matches** opens with the Now playing box, then a tab per pool (plus All and Knockout), then
**Ready to play**, **Waiting on an earlier result**, and a collapsible **Finished** block. A
finished meeting keeps its full controls, so a score entered by mistake can still be changed.

**Standings** carries the pool tables and their tie tools, and below them an **Overall points**
table ranking every team across all pools by team points, then games won, then points
difference. It is built from the pool standings alone, so knockout results never leak into it.

## Participants

Each team gets a private link, `/t/<slug>/team/<token>`, shown (and regeneratable) next
to the team on the admin Teams page. Opening it sets an httpOnly cookie scoped to the
tournament and redirects to `/t/<slug>/team`, so the token itself never sits in the
browser URL after the first visit. From there a participant can rename their team, set
a tagline, colour and description, edit their three players while the tournament is still in
setup, and submit scores for their own current meeting. Participants report
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
- `npm run e2e -w @tournament/web`: Playwright runs four specs against port 3100, sharing the
  steps in `e2e/helpers.ts` — a sign-up run covering the join page, a refused join code, a
  duplicate team name, the welcome banner and private link, a mixed-pair swap, locking from
  the hub closing sign-ups and freezing rosters, the pair names on every game row and the
  overall points table; an
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

Public: `/t/[slug]` (live board), `/t/[slug]/pools`, `/t/[slug]/bracket`, `/t/[slug]/join` (sign-up).
Participant: `/t/[slug]/team/[token]` (one-time link), `/t/[slug]/team` (after the cookie is set).
Admin: `/login`, `/admin`, `/admin/[slug]` (hub), `/admin/[slug]/event`, `/admin/[slug]/rules`,
`/admin/[slug]/teams`, `/admin/[slug]/matches`, `/admin/[slug]/standings`, `/admin/[slug]/draw`,
`/admin/[slug]/announcements`. The old `/admin/[slug]/pools` and `/admin/[slug]/bracket` redirect.

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

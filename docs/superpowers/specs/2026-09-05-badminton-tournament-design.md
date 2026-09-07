# Badminton Tournament App — Design

Date: 2026-09-05
Status: approved in brainstorming, awaiting spec review

## 1. Goal

A hosted web app for running a doubles badminton tournament: pool stage followed by a
single-elimination knockout tree. Admins run the event; participants follow it live on
their phones, customise their team, and submit scores for their own matches. The
tournament rules live in a pure TypeScript package so the app can later be pointed at
other sports by changing settings and rule functions, not the UI.

Out of scope for v1: cross-tournament rankings or ratings, automatic scheduling,
player accounts, singles or mixed events in the same tournament.

## 2. Roles and access

| Role        | How they get in                                  | Can do                                                                                   |
|-------------|--------------------------------------------------|------------------------------------------------------------------------------------------|
| Public      | Tournament URL `/t/[slug]`                       | View live board, pools, standings, bracket, announcements, top seeds. Read only.         |
| Participant | Private team link `/t/[slug]/team/[token]`       | Everything public, plus edit own team name, tagline, colour; submit game scores for own matches. |
| Admin       | Email + password via Supabase Auth, `/admin/...` | Everything: settings, teams, pools, courts, scores, confirmations, announcements.        |

The team token is a random 24-character string generated when the team is created.
Admins can regenerate it if a link leaks.

Opening the private link sets an httpOnly cookie scoped to the tournament and redirects
to `/t/[slug]/team`; the token itself is never stored in the browser URL after that.

## 3. Architecture

- **Frontend and server**: Next.js (App Router, TypeScript), Tailwind. Deployed on Vercel.
- **Database, auth, realtime**: Supabase (Postgres). Admin login through Supabase Auth.
  Public pages subscribe to realtime changes on `matches`, `games`, `score_submissions`,
  `teams` and `announcements` so every open device updates within a second of a change.
- **Tournament logic**: a dependency-free TypeScript package at `packages/tournament-core`
  exporting pure functions (see section 6). No database or React imports. Fully unit
  tested. The Next.js server calls these and persists the results.
- **Writes**: all mutations go through Next.js server actions. Each action re-reads the
  affected rows inside a transaction before writing, so two admins cannot double-advance
  a winner or both confirm a match.
- **Security**: Postgres row-level security allows anonymous `select` on tournament data
  (except `teams.edit_token`) and nothing else. Participant actions receive the token,
  look up the team server-side, and only then act. Admin actions require a Supabase
  session whose user is listed in `tournament_admins`.

## 4. Data model

```
tournaments        id, slug, name, sport ("badminton"),
                   status: setup | pools | knockout | finished,
                   games_per_match (default 3), points_per_game (default 15),
                   win_by_two (bool, default true), max_points (nullable cap, e.g. 21),
                   court_count, advance_per_pool (default 2), created_at

tournament_admins  tournament_id, user_id

players            id, tournament_id, name

teams              id, tournament_id, name, tagline, colour, seed (nullable int, label only),
                   edit_token (secret), pool_id (nullable), pool_order (int)
team_players       team_id, player_id

pools              id, tournament_id, name ("Pool A"), locked (bool)

matches            id, tournament_id, stage: pool | knockout,
                   pool_id (nullable), round (int, knockout only, 1 = first round),
                   slot (int, position within pool schedule or round),
                   team_a_id (nullable), team_b_id (nullable),
                   court (nullable int),
                   status: pending | ready | live | submitted | disputed | done,
                   winner_id (nullable), next_match_id (nullable), next_match_side: a | b

games              match_id, game_no, score_a, score_b        -- the CONFIRMED result

score_submissions  id, match_id, submitted_by: admin | team_a | team_b,
                   games (json: [{game_no, score_a, score_b}]), created_at

announcements      id, tournament_id, body, pinned (bool), created_at
```

Notes:
- Standings are never stored; they are computed from `games` on read.
- The knockout tree is matches linked by `next_match_id`. A first-round bye is a match
  with one team and status `done` from creation, winner set to that team.
- `seed` is a display badge only. It never influences pool or bracket placement.
- `edit_token` is never returned to anonymous clients; a column-level policy hides it.

## 5. Match lifecycle

```
pending   -> both teams known                 -> ready
ready     -> admin assigns court              -> live
ready|live -> team submits full result        -> submitted
ready|live -> admin enters full result        -> done
submitted -> opponent submits same result     -> done
submitted -> opponent submits different one   -> disputed
submitted -> admin confirms                   -> done
disputed  -> a team resubmits matching the other side -> done
disputed  -> admin enters or chooses result   -> done
done      -> admin edits result               -> done (cascade, see 6.5)
```

Rules:
- Players can only submit for a match that is `ready`, `live` or `submitted`, and only
  for a match their team is in. A team may resubmit; only its latest submission counts.
- Submitted but unconfirmed scores are shown on all views tagged "unconfirmed". The
  bracket does not advance until the match is `done`.
- When a match becomes `done`, `games` is written from the accepted submission, the
  winner is computed, and the winner is placed into the next match's `team_a` or `team_b`
  according to `next_match_side`. If that match now has both teams it becomes `ready`.
- Court is cleared when a match becomes `done`.

## 6. Tournament logic (`packages/tournament-core`)

All functions are pure: settings and rows in, new rows or values out.

### 6.1 Score validation
`validateGame(settings, scoreA, scoreB)` — a game is valid when one side reached
`points_per_game`, and if `win_by_two` the lead is at least 2, unless a side reached
`max_points`, where a one-point lead also ends the game (e.g. 21-20 with a cap of 21).
No ties.
`matchResult(settings, games)` — returns the winner once one side has won a majority of
`games_per_match`, or `null` if incomplete. Rejects extra games after the match is decided.
`validateSettings(settings)` returns a list of problems; the admin settings form must
reject settings with any problem (games per match must be odd, the cap must be at least
the game target).
`winnerTeamId(match, winner)` maps the winning side to the team id for `advance`.

### 6.2 Pool generation
`assignPools(teams, poolCount, rng)` — shuffle all teams with the given random source,
deal round-robin into pools. Seeds are ignored. Result is editable by the admin (drag
between pools) until the pool is locked.
`roundRobin(teamIds)` — circle-method schedule so each team plays every other once,
returns ordered `{slot, teamA, teamB}` pairs spread so no team plays twice in a row where
avoidable.

### 6.3 Standings
`poolStandings(teams, matches, gamesByMatch)` returns rows ordered by:
1. match wins (desc)
2. points scored minus points conceded across all games (desc)
3. head-to-head result between the tied teams (only when exactly two are tied)
4. team name (alphabetical) as a stable last resort

Each row carries played, won, lost, games won/lost, points for/against, point diff.
Per pool: the caller passes only that pool's teams and matches.

### 6.4 Knockout generation
`buildBracket(poolResults, advancePerPool, newId)`, where `poolResults` is the ordered
list of `{ poolId, ranked }` from `poolStandings`:
- Take the top `advance_per_pool` from each pool.
- Bracket size is the next power of two ≥ number of qualifiers. Extra slots become byes.
- Placement: qualifiers get a global seed order (all pool winners first, then all
  runners-up, and so on) and sit in the standard bracket layout (seed 1 v seed N,
  seeds 1 and 2 in opposite halves). Within each rank tier the pool order is rotated by
  the smallest amount that avoids two teams from the same pool meeting in round one.
  With two pools this gives A1 v B2 and B1 v A2; with four pools A1 v D2, D1 v A2,
  B1 v C2, C1 v B2. Because byes go to the highest global seeds, pool winners receive
  them first.
- Emits every match for every round with `next_match_id` and `next_match_side` links.
Pool finishing position is the only input. Seeds are not consulted.

### 6.5 Advancement and rollback
`advance(matches, matchId, winnerId)` — writes the winner into the linked match; returns
the list of matches changed. It refuses to re-enter a different winner on a match that
is already done; the caller must `rollback` first.
`rollback(matches, matchId)` — when an admin edits a `done` match, clears the old winner
from downstream matches recursively, resets their status (and deletes their games and
submissions) and returns the list of affected matches so the UI can ask for confirmation
before committing. It also returns the edited match itself reset to `ready` (winner and
court cleared), so the caller applies the changes and calls `advance` with the new winner.

### 6.6 Live board
`liveBoard(matches)` — "now playing": matches with status `live`, grouped by court.
"Up next": during pools, the lowest-slot `ready` match per pool; during knockout, the
lowest-slot `ready` match per round, earliest round first.

## 7. Screens

### Public `/t/[slug]`
- **Live** (default tab): pinned announcement banner; Now playing cards (court, teams,
  colours, current confirmed or unconfirmed game scores); Up next list; Top seeds panel
  (teams with a seed badge, in seed order); latest results feed.
- **Pools**: one standings table per pool, each row expandable to that team's matches.
- **Bracket**: horizontal tree, sideways scroll on phones with zoom buttons. Each node
  shows team names, colours, seed badge if any, per-game scores when done, a pulse when
  live, an "unconfirmed" tag when submitted.
- **Announcements**: newest first, pinned on top.

### Participant `/t/[slug]/team` (after the token handshake)
The "My team" tab appears in the public layout when the private-link cookie is present,
alongside the same public tabs, and shows a panel: edit name, tagline, colour; next
match and court; an **Enter scores** form for the team's current match with one row per
game, a running "you win / they win" indicator, and a clear note that the result needs
the other team or an admin to confirm.

### Admin `/admin/[slug]` (login required)
- **Setup**: settings (games per match, points per game, win by two, max points, courts,
  advance per pool); add teams by pasting one pair per line ("Alice & Bob"); assign seed
  badges; copy or regenerate each team's private link; move status setup → pools.
- **Pools**: choose pool count, generate (random), drag teams between pools, lock all.
  Locking creates the pool matches and sets tournament status to `pools`.
- **Matches**: list filtered by stage and status; assign court; keypad score form; a
  **Needs attention** section at top listing `submitted` and `disputed` matches with
  one-tap confirm or a side-by-side comparison of the two submissions.
- **Bracket**: enabled once every pool match is `done`; "Start knockout" button shows the
  proposed tree for review, then creates it and sets status to `knockout`. Afterwards it
  is the same tree as public with tappable nodes to edit.
- **Announcements**: post, pin, delete.

## 8. Error handling

- Game score validation runs client-side for instant feedback and again in the server
  action, which is the source of truth.
- Server actions return typed errors (`invalid_score`, `match_not_editable`,
  `not_your_match`, `stale_state`) that the UI shows inline.
- Editing a `done` match shows the rollback preview from 6.5 and requires confirmation.
- Realtime disconnects show a small "reconnecting" indicator and refetch on reconnect.
- Team token lookups are rate limited per IP to slow guessing.

## 9. Testing

- `tournament-core` unit tests: game validation for every setting combination; match
  result including rejection of extra games; random pool dealing produces balanced pools;
  round-robin correctness for 3 to 8 teams; each standings tie-break in isolation and in
  combination; bracket placement for 4, 8, 16 slots with 0, 1 and several byes;
  advancement; rollback cascades through two rounds; live board selection.
- Server action tests against a local Supabase instance: participant cannot edit another
  team, cannot submit for another match, cannot advance a match; matching opponent
  submission confirms, mismatch disputes; concurrent confirms produce one winner.
- One Playwright end-to-end test: 16 teams, 4 pools, play through to a champion, with
  at least one player-submitted and one disputed match along the way.

## 10. Extensibility notes

Sport-specific behaviour is confined to the `settings` object and the functions in 6.1.
The standings tie-break order in 6.3 is fixed for v1; supporting a sport with a different
order means adding a tie-break field to `settings` and a `settings` parameter to
`poolStandings`. Adding another sport means new default settings and, if needed, a
different `validateGame` or tie-break order registered against the `sport` field. Views
and the match lifecycle are sport-agnostic.

## 11. v1.1 addendum (agreed 2026-09-07): club format, overrides, scheduling

Driven by the first real event: 4 pools, round robin, one game to 15 per match with a
13-minute clock, top two per pool to a top-8 knockout, men's doubles playoff for a 2nd/3rd tie.

### 11.1 Scoring
> **Amended by section 12 (v1.2):** a meeting is three named games, every one of them played,
> and the meeting goes to whoever wins more of them.

- Settings are per stage. Pool and knockout each have `games_per_match`, `points_per_game`,
  `win_by_two`, `max_points`, `time_cap_minutes` (null = no clock). Knockout defaults to the
  pool values; the organiser changes them later without code changes.
- A game may be marked **time expired**. A normal game must reach `points_per_game` (and
  respect `win_by_two`/`max_points`). A time-expired game accepts any two different
  non-negative scores not exceeding the cap (a tie at expiry is settled on court by one
  deciding point, so the recorded score is never level).
- A match win is worth **1 team point**. Standings show Played, Won, Points, Score ± (points
  for minus against).

### 11.2 Standings order and ties
Within a pool: team points desc; then, for teams still tied: a recorded **playoff** between
exactly two tied teams (winner ranks higher); then head-to-head (two-way ties); then score
difference; then the order is **unresolved**. Unresolved ties that touch the qualification line
or the 1st/2nd order are flagged to the admin, who either records a playoff (an extra match
of stage `playoff` inside the pool; its result does not add team points) or sets the pool's
finishing order by hand (`manual order`, shown publicly as "order set by organiser").

### 11.3 Overrides (admin)
- **Award match**: decide any match for either team without scores (`decided_by = awarded`);
  on a done match this behaves like editing the result (downstream rollback).
- **Withdraw team**: marks the team withdrawn; every unplayed match with a known opponent is
  awarded to the opponent (`decided_by = forfeit`). Reinstating clears the flag; already
  awarded matches stay until the admin changes them.
- **Replace team in bracket slot**: swap the team in any knockout match that is not done.

### 11.4 Match flow and clock
> **Amended by section 12 (v1.2):** the court and the clock belong to an individual game, not
> to the meeting, and the organiser enters scores one game at a time.

- "Start now" starts a match on the first free court (dropdown to override) and stamps
  `started_at`. A live match shows a countdown from `time_cap_minutes` on the live board and
  the admin Matches screen, turning red when expired.
- Result entry stays on the page: errors appear next to the form, typed scores are kept, and
  the Save button is enabled only when the games form a complete, valid result.

### 11.5 Tournament details
- `starts_at` (date and time) and `venue` are set at creation and editable in Settings; shown
  in the public header.
- Team taglines appear under team names on cards, bracket boxes and standings.

## 12. v1.2 addendum (agreed 2026-09-08): three games per meeting

Amends 11.1 and 11.4. Driven by how the club actually plays: two teams meet for a fixed set
of three games rather than a single game, and each of those games is called on and clocked
by itself.

### 12.1 The format
- A **meeting** between two teams is **three games**. The word "match" in sections 1-11 means
  a meeting; a "game" is one of its three.
- Each game has a **name**, configurable per tournament in `tournaments.game_labels` (one
  label per game, in order). The default is `Mixed doubles #1`, `Mixed doubles #2`,
  `Men's doubles`.
- `games_per_match` must be **odd**, so a meeting can never be drawn. Three is the default;
  the per-stage settings of 11.1 are otherwise unchanged, and each game is validated exactly
  as 11.1 describes (including **time expired**).

### 12.2 All games are always played
- A new setting, `play_all_games`, is **on** by default. With it on, a meeting does **not**
  stop when one side reaches a majority: all three games are played even at two games to nil.
- The meeting is complete only when every one of its games has a score, and it then goes to
  the team that **won more games**. That is still worth **1 team point** (11.1), and every
  game's score counts towards Score ± — which is the point of playing the dead rubber.
- With `play_all_games` off, the traditional majority rule of 11.1 stands unchanged: the
  meeting stops as soon as one side cannot be caught, and a game recorded after that is
  rejected.

### 12.3 Scheduling and the clock belong to the game
- The court and the clock are properties of a **game**, not of the meeting. A `games` row
  carries `court`, `started_at`, `paused_at` and `paused_ms`; `matches` carries none of them.
- **Start now** sends one game to a court (first free by default, or a chosen one) and stamps
  that game's `started_at`. **Take off court** clears it. The three games of a meeting can be
  on three different courts at once, or hours apart.
- Each running game counts down `time_cap_minutes` from its own `started_at`. The end time
  stays derived, so nothing is written per tick and every viewer sees the same clock.
- **Pause** and **Resume** stop and restart that countdown. A stoppage is *recorded*, not
  rewound: `paused_at` freezes the clock, and resuming folds the length of the stoppage into
  `paused_ms`, so time spent stopped never eats into the cap.
- Saving a game's score also takes it off its court and clears its clock: the game is over.
- The meeting's status is derived from its games — `live` while any game of it is on court,
  `done` once the last game is scored.

### 12.4 Entering scores
- The organiser scores **one game at a time**: every unscored game of a meeting shows its own
  small form (two scores, a **Time up** box when the stage has a clock, **Save**). There is no
  whole-meeting score form on the admin Matches screen any more.
- A saved game reopens with **Change** and is rubbed out with **Clear**. Changing or clearing
  a game on a meeting that already has a result asks for confirmation and rolls back every
  later match that depended on it, exactly as 11.3 and 6.5 describe.
- **Participants are unchanged**: a player still reports the whole meeting at once, all three
  games on one form, and the matching/disputing rules of section 8 apply to that submission as
  before.

### 12.5 Now playing
- The admin Matches screen and the public live page both open with a **Now playing** box above
  everything else, listing the games on court right now — the meeting's two teams, the game's
  name, its court and its clock — ordered by court number.
- The organiser's copy of the box carries the same per-game controls as the meeting card
  (pause, resume, take off court, enter the score), so the game on court can be dealt with
  without hunting for its meeting. A running game therefore appears twice on that screen by
  design.
- "Up next" is likewise a list of **games**: the earliest unstarted game of the earliest
  unplayed meeting in each pool (or knockout round).
- The board is computed by the application, not by `tournament-core`: that package no longer
  knows about courts, clocks or boards.

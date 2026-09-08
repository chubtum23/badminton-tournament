# Team sign-up, rosters and organiser UX (v1.3)

Addendum to `2026-09-05-badminton-tournament-design.md` (§11 club format, §12 three games
per meeting). Where this document and the earlier one disagree, this one wins.

Delivered as two plans:

- **Plan 6 (this spec §1–§4):** rosters with roles and gender, public team sign-up, pair
  names on meeting cards, the organiser checklist hub and regrouped admin screens.
- **Plan 7 (this spec §5):** public Teams page, overall leaderboard, draw tree.

Each plan merges on its own; the live site keeps working between them.

## 0. Decisions made during brainstorming

| Question | Decision |
|---|---|
| How a team enters | Public sign-up link per tournament, optional join code, organiser can still add/remove teams |
| Roster rule | Exactly 2 men + 1 woman, enforced. Men's doubles is always the two men. |
| Who enters genders | Nobody types a gender. The sign-up form has three boxes: *Man playing Mixed #1*, *Man playing Mixed #2*, *Woman*. The box determines gender and role. |
| Leaderboard | Pool-stage points only, same ordering as a pool table, across all pools |
| Team profile | Colour circle with initials, tagline, description. No image uploads. |
| Draw tree | Pools feeding the knockout. Mirrored with the final in the centre on wide screens; left-to-right with stacked pools on narrow ones. |
| Setup layout | Checklist hub of four tiles, each opening a focused page |
| Meeting card | One row per game: label, the two pairs, score, one next-step button |
| Roster storage | Extend player rows (gender) and the team↔player link (role). No JSON blob, no captain accounts. |

### Changed during implementation

Three decisions were made after this spec was written and are reflected in the code:

1. **No `update_team_roster` token function.** A participant's roster edits go through the
   service-role client *after* `currentParticipant` has validated the cookie, calling the
   internal `write_roster` — the same path profile edits already used. `sign_up_team` is
   therefore the **only** anonymous write in the system. See §2.4.
2. **Organisers write rosters through checked functions**, `admin_add_team` and
   `admin_set_roster`, rather than the ordinary authenticated RLS path: writing three players
   and three links row by row can leave a half-written roster. Both wrap `write_roster`.
3. **`join_code` is hidden from clients.** `select` on `tournaments` is revoked from `anon` and
   `authenticated` and re-granted column by column without it, so the code cannot be read or
   used as a filter oracle. The join page asks `signup_needs_code(p_slug)` whether one is set;
   an organiser reads its value through `tournament_join_code(t)`. A unique index on
   `(tournament_id, lower(name))` backs the case-insensitive team-name rule, since the
   `exists` check alone races once sign-up is anonymous.

## 1. Data model

### 1.1 Players and roles

```sql
alter table public.players add column gender text not null default 'male'
  check (gender in ('male','female'));

alter table public.team_players add column role text
  check (role in ('mixed1','mixed2','woman'));
create unique index team_players_role_unique on public.team_players (team_id, role)
  where role is not null;
```

- Existing rows: `gender` defaults to `male`; `role` stays null. The backfill (see 1.4) fills
  roles for teams that already have exactly three players. Teams left with an incomplete
  roster are shown with an **"Incomplete roster"** badge on the organiser's Teams page and
  cannot be included when pools are locked (locking refuses with the team names).
- A **complete roster** is exactly three `team_players` rows for the team with roles
  `mixed1`, `mixed2`, `woman`, where the `mixed1` and `mixed2` players are `male` and the
  `woman` player is `female`. This is enforced in the sign-up and roster-update functions and
  re-checked by `lockPools`.

### 1.2 Tournament sign-up columns

```sql
alter table public.tournaments
  add column signup_open boolean not null default true,
  add column join_code text check (join_code is null or length(join_code) between 3 and 30);
```

- `signup_open` is forced to `false` by `lockPools` and restored to nothing by unlock (the
  organiser reopens it by hand if they want more teams after unlocking).
- `join_code` is compared case-insensitively after trimming. Blank means no code.

### 1.3 Team description

```sql
alter table public.teams add column description text not null default ''
  check (length(description) <= 400);
```

### 1.4 Migration

One file, `supabase/migrations/<ts>_team_signup.sql`, containing 1.1–1.3, the backfill and
the functions in §2.4.

Backfill: for each team with exactly three players and no roles, assign `mixed1`, `mixed2`,
`woman` in `player.name` order and set the third player's gender to `female`. This is only to
keep local and test data valid; the hosted database has no real teams yet.

### 1.5 Realtime

`teams` and `team_players` remain outside the realtime publication. A new sign-up appears on
the organiser's screen at their next refresh; the Teams page carries a small "refresh" link.

## 2. Sign-up

### 2.1 Route `/t/[slug]/join`

Anonymous page. Shows the tournament name, date and venue, then one form:

| Field | Rules |
|---|---|
| Team name | required, 1–40 chars, unique within the tournament (case-insensitive) |
| Tagline | optional, ≤ 80 |
| Colour | colour input, default `#2563eb` |
| Description | optional, ≤ 400 |
| Man playing Mixed #1 | required, 1–60 |
| Man playing Mixed #2 | required, 1–60 |
| Woman | required, 1–60 |
| Join code | shown only when the tournament has one; required then |

Helper text under the player boxes: *"Your woman plays both mixed games. Your two men play
the men's doubles together."*

Submit button: **Sign our team up**. On success the browser is redirected through the
one-time link route so the team cookie is set, landing on `/t/[slug]/team` with a banner:
*"You're in. Save this private link, it is the only way back to your team page:"* followed by
the link and a **Copy** button. The link is shown on the team page permanently after that
(it already is today).

When `signup_open` is false the page shows *"Sign-ups are closed. Ask the organiser to add
your team."* and no form. When the tournament status is not `setup` the same message shows.

### 2.2 Errors

Returned inline above the form, keeping typed values: duplicate name, wrong join code,
sign-ups closed, validation failures. Rate limit: 10 sign-up attempts per minute per client,
using the existing limiter with a separate bucket.

### 2.3 Team page changes (`/t/[slug]/team`)

Until pools lock the team can:

- rename the team, edit tagline, colour, description (description is new);
- edit the three player names;
- **Swap** which man plays Mixed #1 (one button, swaps the two roles).

After pools lock the roster is read-only with the note *"The draw is locked, so players
can't change. Ask the organiser if someone is injured."*; profile fields stay editable.

### 2.4 Database functions (security definer, `search_path = public`)

```sql
sign_up_team(p_slug text, p_join_code text, p_name text, p_tagline text, p_colour text,
             p_description text, p_mixed1 text, p_mixed2 text, p_woman text)
  returns text  -- the new team's edit_token
```

Checks, in order: tournament exists and `status = 'setup'`; `signup_open`; join code
matches (case-insensitive, trimmed) when set; name unique (case-insensitive) within the
tournament; lengths. Inserts team, three players (`male`,`male`,`female`), three
`team_players` rows with roles. Raises `signup_closed`, `bad_join_code`, `duplicate_name`,
`invalid_input` as `raise exception using errcode = 'P0001', message = '<code>'` so the app
maps them to messages. Grant execute to `anon` and `authenticated`.

```sql
write_roster(p_team uuid, p_mixed1 text, p_mixed2 text, p_woman text) returns void
admin_add_team(p_tournament uuid, p_name text, p_mixed1 text, p_mixed2 text, p_woman text) returns uuid
admin_set_roster(p_team uuid, p_mixed1 text, p_mixed2 text, p_woman text) returns void
signup_needs_code(p_slug text) returns boolean
tournament_join_code(t uuid) returns text
```

**As built** (superseding the `update_team_roster` originally specified here):
`write_roster` replaces a team's three players atomically and is the single place the roster
rule lives; it is executable by `service_role` only. A participant's edit and the mixed-pair
swap call it through the service-role client *after* `currentParticipant` has validated the
cookie and the status is `setup`, so no second anonymous write path exists. Organisers use
`admin_add_team` / `admin_set_roster`, which re-check `is_tournament_admin` and the stage
before delegating to `write_roster`. `signup_needs_code` is anon-callable and answers only
yes or no; `tournament_join_code` returns the code to an admin and raises `not_admin`
(errcode 42501) to anyone else.

### 2.5 Organiser controls

Teams page header: the sign-up link with **Copy**, an **Open / Close sign-ups** toggle, and
a join code field with **Save code**. Count line: *"6 teams signed up, 6 complete rosters."*

## 3. Rules package (`@tournament/core`)

### 3.1 Roster and pairs

```ts
export type Gender = 'male' | 'female';
export type RosterRole = 'mixed1' | 'mixed2' | 'woman';
export interface RosterPlayer { id: string; name: string; gender: Gender; role: RosterRole | null }

export function validateRoster(players: RosterPlayer[]): { ok: true } | { ok: false; reason: string };
// exactly 3, roles mixed1/mixed2/woman each once, mixed1+mixed2 male, woman female

export type PairSlot = 'mixed1' | 'mixed2' | 'mens';
export function pairFor(players: RosterPlayer[], slot: PairSlot): [RosterPlayer, RosterPlayer] | null;
// mixed1 → [mixed1 man, woman]; mixed2 → [mixed2 man, woman]; mens → [mixed1 man, mixed2 man]
// null when the roster is incomplete

export function pairSlotForGame(gameNo: number): PairSlot;
// 1 → mixed1, 2 → mixed2, 3 → mens; gameNo > 3 → mens (extra games default to men's doubles)
```

The mapping from game number to pair is fixed by position, not by label text, so renaming
"Mixed doubles #1" to "Mixed 1" changes nothing. The Setup page's game-name fields carry
helper text saying which pair plays each numbered game.

### 3.2 Overall leaderboard

```ts
export interface LeaderboardRow extends StandingRow { poolName: string; overallRank: number }
export function overallLeaderboard(pools: { poolName: string; rows: StandingRow[] }[]): LeaderboardRow[];
```

Concatenates the pool standings, sorts by the same comparator the pool table uses (team
points, then games won, then points difference, then name), assigns dense `overallRank`
(equal keys share a rank), ignores knockout results by construction since it takes pool
standings as input. Withdrawn teams sort last with their points intact.

## 4. Organiser screens (plan 6)

### 4.1 Shell

`/admin/[slug]/layout.tsx` renders: tournament name; date and venue line; a **status line**
(`Setup · 6 of 8 teams signed up` / `Pool stage · 3 games on court` / `Knockout · Final next`
/ `Finished · Champion: <team>`); nav **Home · Teams · Matches · Standings · Draw ·
Announcements**. Existing routes are kept and re-pointed:

| Old | New |
|---|---|
| `/admin/[slug]` (settings + teams) | `/admin/[slug]` hub |
| — | `/admin/[slug]/event`, `/admin/[slug]/rules` (focused forms split from the old page) |
| — | `/admin/[slug]/teams` |
| `/admin/[slug]/pools` | `/admin/[slug]/standings` (old path redirects) |
| `/admin/[slug]/matches` | unchanged |
| `/admin/[slug]/bracket` | `/admin/[slug]/draw` (old path redirects) |

Button conventions: one primary dark button per form, always a verb ("Save rules", "Lock
pools and create matches", "Start now"). Destructive: red text, `confirmMessage`. Helper
text under every field in `text-sm text-slate-600`; inputs at least 44 px tall.

### 4.2 Hub (`/admin/[slug]`)

Four tiles in a single column, each a link:

| Tile | Summary line | Pill |
|---|---|---|
| 1. Event details | date · venue, or "Not set" | Done when both set |
| 2. Rules | "3 games to 15 · 13 min clock · 4 courts · top 2 per pool" | Done always (defaults are valid); "Locked" after pools lock |
| 3. Teams | "N signed up · M complete · sign-ups open/closed" | Done when N ≥ 4 and M = N, else "To do" |
| 4. Pools and draw | "Not drawn" / "4 pools, 24 meetings" / "Knockout started" | Done once locked |

Below the tiles, the stage button: **Lock pools and create matches** (disabled with the
reason when Teams is not Done), then **Unlock pools** + **Start the knockout**, then
nothing once the knockout exists. This replaces the buttons currently on the pools page.

### 4.3 Event and Rules pages

Split of today's settings form. Event: date/time, venue. Rules: pool stage, game names
(each with "played by: Mixed #1 pair / Mixed #2 pair / the two men"), knockout stage,
courts, advance per pool. Same validation and lock behaviour; the hidden-mirror trick for a
locked form is kept.

### 4.4 Teams page

Header controls from §2.5. Then a list of rows: colour dot, name, tagline, roster badge,
caret. Expanded: the three players with role labels and an **Edit roster** form (three
boxes + Save), **Copy link**, **Regenerate link**, **Remove team**. **Add a team** at the
bottom uses the same three-box form plus name. Withdraw/reinstate stay here.

### 4.5 Matches page

Order: Now playing box; pool tabs (All, A, B, C, D, Knockout); **Ready** meetings; **Finished**
collapsed. Meeting card = game rows (§0). Each row shows `pairFor` names under each team,
e.g. `Alex & Priya` · `Sam & Jo`, or `—` when a roster is incomplete. The row's button
follows state: **Start now ▾** (court picker) → **Pause / Save** → **Change / Clear**.

### 4.6 Standings page

Pool tables, tie tools (only when a pool is complete, as now), then **Overall points** using
`overallLeaderboard` with columns Rank · Team · Pool · P · W · Pts · +/−.

### 4.7 Lock pools

`lockPools` additionally refuses when any non-withdrawn team fails `validateRoster`, returning
`incomplete_roster` with the team names, and sets `signup_open = false`.

## 5. Public pages (plan 7)

### 5.1 Nav

**Live · Teams · Standings · Draw** (Announcements stays where it is). `/t/[slug]/pools`
becomes `/t/[slug]/standings` and `/t/[slug]/bracket` becomes `/t/[slug]/draw`; old paths
redirect.

### 5.2 Teams (`/t/[slug]/teams`)

Responsive grid of cards. Card: 48 px circle in the team colour with up to two initials in
white, name, tagline, description, caret. Expanded: three members with role labels (Mixed #1,
Mixed #2, Woman; men's doubles noted as "both men"). Ordered by pool then name once pools
exist, otherwise by name. Withdrawn teams are greyed with a "Withdrawn" label.

### 5.3 Standings

Pool tables as today plus the overall leaderboard (§4.6 columns) beneath.

### 5.4 Draw (`/t/[slug]/draw`)

Server component fetching pools, standings and the knockout bracket. Two layouts chosen by a
CSS container query on width (breakpoint 1100 px):

- **Wide (mirrored):** columns `Pools A·B | QF | SF | FINAL | SF | QF | Pools C·D`. Quarter-
  finals are assigned to sides by their pool sources: matches whose top seed comes from pool
  A or B go left, C or D go right. With more or fewer than four pools the page falls back to
  left-to-right.
- **Narrow (left-to-right):** `Pools (stacked) | QF | SF | FINAL` inside an `overflow-x:auto`
  box.

Pool box: name, rows of team name and team points, the top `advance_per_pool` rows
highlighted. Knockout box: two slots with colour dot, name (or "Winner of QF 3" / "Bye"),
games won; under it the scheduled time and court, or `LIVE · Court n · mm:ss` via the
existing `CourtClock` when a game is on court. Connector lines reuse the `.bk-slots`
technique from `Bracket.tsx`, mirrored on the right half. Before the pools lock the pool
boxes show the teams in name order and the knockout boxes are empty.

### 5.5 Live page

Each Now playing line and each meeting line adds the pair names beneath the team names.

## 6. Security

- Anonymous clients can still never read `teams.edit_token`; `sign_up_team` returns it once
  to the caller only, and the redirect immediately converts it to the httpOnly cookie.
- `sign_up_team` and `update_team_roster` are the only anonymous write paths; both validate
  every length and the roster rule server-side.
- Join code is not a secret in the cryptographic sense; it only stops casual forwarding.
  It is compared in the function, never sent to the browser.
- Sign-up attempts share the existing in-memory limiter with their own bucket (10/min).

## 7. Testing

- **Core:** `validateRoster` (complete, missing role, duplicate role, wrong gender, four
  players), `pairFor` all three slots and incomplete roster, `pairSlotForGame` 1–4,
  `overallLeaderboard` (ordering across pools, dense ranks on ties, withdrawn last).
- **Integration (live local DB):** `sign_up_team` happy path returns a token and creates 3
  players with correct genders/roles; duplicate name; wrong code; closed sign-ups; status
  not setup; anonymous cannot read `edit_token` afterwards; `update_team_roster` with a bad
  token fails; `lockPools` refuses an incomplete roster and closes sign-ups.
- **Unit (web):** hub tile summaries and pills from a tournament snapshot; draw side
  assignment for QFs; status line text.
- **Playwright (`signup.spec.ts`):** organiser creates a tournament, copies the join link;
  eight teams sign up through the form (one with a wrong code first); organiser sees
  "8 complete" and locks; a meeting card shows the right pair names under each game; team
  page swap is refused after lock; public Teams page expands a card; leaderboard shows all
  eight; draw page renders eight pool rows and four QF boxes.

## 8. Out of scope

Photo uploads, captain accounts, individual player rankings (the data now supports them),
per-tournament roster rules for other sports, email notifications.

# Player performance ratings and the individual leaderboard (v1.4)

Addendum to `2026-09-05-badminton-tournament-design.md` and
`2026-09-08-team-signup-and-organiser-ux-design.md`. Where this document and the earlier ones
disagree, this one wins.

Every game already knows exactly who played it: a team is two men and one woman, and
`pairSlotForGame` fixes the pair per game (1 = Mixed #1 + the woman, 2 = Mixed #2 + the woman,
3 = the two men). So four named players stand on court for every game, and no lineup is ever
entered. This spec adds a rating out of 10 for each of them, and the two leaderboards that
average those ratings.

## 0. Decisions made during brainstorming

| Question | Decision |
|---|---|
| Who rates | The organiser, at score entry, working from a suggestion the system pre-fills |
| What a rating attaches to | One game played by one player. A player rated twice in a tie has both ratings count. |
| Reach | Within one tournament. No club-wide player identity; that stays a later project. |
| Suggestion | Derived from that game's point margin only. No opponent-strength term. |
| Visibility | A public Players tab, visible to everyone |
| Team score | The average of its players' averages |
| Small samples | No guard. Raw averages, with a games-rated column beside them. |
| Where it is entered | Inline in the existing game score form, saved by the same action as the score |

## 1. The rating

A rating is one number from 1.0 to 10.0 with one decimal place, attached to
`(match, game, player)`.

The organiser never faces an empty box. Once both scores of a game are typed and valid, a
suggestion is computed from that game's margin:

```
d          = clamp(-1, 1, (ownScore - oppScore) / pointsPerGame)
suggestion = clamp(1, 10, round1(5.5 + 4 x d))
```

5.5 is the exact middle of 1-10, so a dead-level game suggests 5.5 to all four players. At 15
points a game:

| Score | Winning side | Losing side |
|---|---|---|
| 15-13 | 6.0 | 5.0 |
| 15-9 | 7.1 | 3.9 |
| 15-3 | 8.7 | 2.3 |
| 15-0 | 9.5 | 1.5 |

Both players on a side start from the same suggestion; the organiser's edits are the only thing
that separates partners. A clock-ended game uses the same formula on whatever score it reached,
and `pointsPerGame` is the setting in force for that stage (pool or knockout), so knockout games
with different settings scale correctly.

## 2. Entering ratings

`GameScoreForm` grows a second row, shown only when both scores are present and
`validateGame` passes. It holds four boxes, one per player, each labelled with the player's name
and their team, pre-filled with the suggestion. Re-typing a score before saving re-fills any box
the organiser has not touched by hand; a box the organiser has edited keeps its value.

`saveGameScore` writes the ratings in the same call that writes the score, so what is stored is
always exactly what the organiser saw when they pressed Save. Rules:

- A box left empty records no rating for that player. This is how the organiser skips someone.
- A team whose roster is incomplete (a legacy row with no roles) yields no ratable players on
  its side, and only the other team's two boxes are shown.
- Saving a changed score overwrites that game's ratings.
- `clearGameScore` deletes that game's ratings.
- A bracket rollback deletes the ratings of every match it blanks, alongside the game scores it
  blanks. Blanking does not delete the `games` rows, so the foreign key's cascade does not fire
  here and the delete is explicit.
- A rating outside 1-10, or with more than one decimal place, is rejected by the action with
  `invalid_input`, and the whole save fails; the score is not written either.

## 3. Storage

One new table, in a new migration:

```sql
create table public.player_ratings (
  match_id  uuid not null,
  game_no   int  not null,
  player_id uuid not null references public.players(id) on delete cascade,
  rating    numeric(3,1) not null check (rating >= 1 and rating <= 10),
  primary key (match_id, game_no, player_id),
  foreign key (match_id, game_no) references public.games(match_id, game_no) on delete cascade
);
create index player_ratings_player_idx on public.player_ratings (player_id);
```

`numeric(3,1)` enforces the single decimal place at the database level.

RLS follows the existing pattern exactly: `enable row level security`, a `select` policy of
`using (true)` for everyone, and one `for all to authenticated` policy whose check is
`exists (select 1 from public.matches m where m.id = match_id and public.is_tournament_admin(m.tournament_id))`.
Nothing here is secret, so no column grants are narrowed.

## 4. Computing the leaderboards

A new pure module, `packages/tournament-core/src/ratings.ts`, exported from `index.ts` beside
`leaderboard.ts`:

- `suggestRating(settings, own, opp): number` - the formula of section 1.
- `playerRatings(players, ratings): PlayerRatingRow[]` where a row is
  `{ playerId, name, teamId, teamName, gamesRated, average, rank }`. Sorted by average
  descending, ties ordered by name. `rank` is a dense rank over the average **as displayed**
  (rounded to one decimal), so two players showing 7.4 always share a rank.
- `teamRatings(playerRows): TeamRatingRow[]` where a row is
  `{ teamId, name, playersRated, average, rank }`. A team's average is the mean of its players'
  averages; a player with no ratings is excluded from that mean rather than counted as zero.
  Same dense ranking.

A player with no ratings has `gamesRated: 0`, `average: null` and `rank: null`, and sorts to the
bottom under every other row. A team none of whose players have been rated does the same. This is
the only concession to thin records: the numbers themselves are raw averages, never adjusted.

## 5. The Players page

A public tab, `Players`, on the tournament shell beside Pools and Bracket, served from
`app/t/[slug]/players/page.tsx`.

At the top, a two-way filter - **Players** / **Teams** - swaps which table is shown. The
individual table lists rank, name, team, games rated, and average. The team table lists rank,
team, players rated, and average. An unranked row shows a dash for both rank and average.

Styling uses the tokens already in `components/ui.ts` and the shape of `StandingsTable`. The
filter control and both tables carry `data-testid` attributes, because the Playwright specs
select on those and never on classes.

## 6. Testing

**Unit (`ratings.test.ts`)**: the formula at its boundaries (level game, one-sided game, a margin
past `pointsPerGame`, the 1 and 10 clamps, rounding to one decimal); both leaderboards for ties
sharing a rank, an empty tournament, unrated players sorting last, and a team where only one of
three players has ratings.

**Unit (form)**: the parser that reads four rating boxes out of the form data accepts blanks,
rejects 0, 10.5 and 7.25.

**Integration**: anon can read `player_ratings` and cannot write them; an admin of another
tournament cannot write them either. Saving a score writes four ratings, clearing it removes
them.

**End to end**: a spec that scores a game with the suggested ratings, opens the Players tab, sees
the four averages, and toggles to the team view.

## 7. Explicitly out of scope

- Club-wide, cross-tournament player averages. Ratings are stored per game, so this can be added
  later by introducing a club-level player identity, with no change to what is written now.
- Opponent-strength adjustment in the suggestion.
- Participants rating each other, and any public view of an individual game's rating: the tab
  shows averages only.

# @tournament/core

Pure tournament rules. No database, no UI, no runtime dependencies. Every function
takes plain objects in and returns new objects out; nothing is mutated.

Sport-specific behaviour lives in `Settings` (`gamesPerMatch`, `pointsPerGame`,
`winByTwo`, `maxPoints`, `timeCapMinutes`). `Settings` can be applied per stage (pool,
knockout, playoff), not just per tournament. `BADMINTON_DEFAULTS` is the club-night
format: one game to 15, win by one, no point cap, 13-minute clock. `CLASSIC_BEST_OF_THREE`
is the traditional format: best of 3 to 15, win by two, cap 21, no clock.

`timeCapMinutes` is the number of minutes before the clock ends a game; `null` means
there is no clock for that stage. A `Game` may carry `timeExpired: true` to mean the
clock (not a completed rally to target) ended it: `validateGame`/`matchResult` then
accept any non-level score up to the settings' point ceiling, but still reject a level
score (the deciding point is always played out on court) and refuse the flag entirely
when `timeCapMinutes` is `null`. `validateSettings` requires `timeCapMinutes` to be
`null` or a positive integer.

`Match.stage` also allows `'playoff'` for placement/consolation matches: `liveBoard`
never queues a playoff match in `upNext`, but still shows it in `nowPlaying` once live.

Every `Match` carries `decidedBy: 'played' | 'awarded' | 'forfeit'`, recording how its
result was reached.

| Export | Purpose |
|---|---|
| `BADMINTON_DEFAULTS` | Club-night `Settings`: one game to 15, win by one, no cap, 13-minute clock. What a new tournament starts on. |
| `CLASSIC_BEST_OF_THREE` | Traditional `Settings`: best of 3 to 15, win by two, cap 21, no clock. |
| `validateGame(settings, a, b, timeExpired?)` | Is this a legal finished game score? Returns the winning side or a reason. With `timeExpired` the clock ended the game: any non-level score up to the ceiling passes, a level score still fails, and the flag is rejected outright when the stage has no `timeCapMinutes`. |
| `matchResult(settings, games)` | Winner of a match from its games, or incomplete, or an error naming the bad game. |
| `gamesNeeded(settings)` | Number of games needed to win a match under these settings. |
| `winnerTeamId(match, winner)` | Map a matchResult winner side to the team id occupying that side. |
| `validateSettings(settings)` | Check a `Settings` object for internal consistency; returns a list of problems, empty if valid. |
| `shuffle(items, rng)` | Fisher-Yates shuffle using an injected random source, for deterministic tests. |
| `assignPools(teamIds, poolCount, rng)` | Shuffle and deal teams into pools. Seeds are ignored on purpose. |
| `roundRobin(teamIds)` / `poolMatches(poolId, teamIds, newId)` | Every-team-plays-every-team schedule, as pairings or as ready `Match` rows. |
| `poolStandings(teams, matches, gamesByMatch, options?)` | Table ordered by team points (one per win), then a recorded playoff, head-to-head, point difference, and finally name (flagging `tieUnresolved`). Playoff matches are consulted as tie-breakers but excluded from played/points/score. `options.manualOrder` overrides the computed order and clears all `tieUnresolved` flags. |
| `unresolvedTies(rows, advancePerPool)` | Which unresolved tie groups in a standings table affect qualification (span the cutoff) or seeding (include first place). |
| `bracketSize(qualifierCount)` | Next power of two at or above the qualifier count. |
| `bracketOrder(size)` | Standard single-elimination seed pairing order for a bracket of this size. |
| `seedQualifiers(poolResults, advancePerPool)` | Global seed order for pool qualifiers, rotated to avoid same-pool round-one meetings. |
| `buildBracket(poolResults, advancePerPool, newId)` | Single-elimination tree from pool finishing positions, with byes resolved and matches linked. |
| `advance(matches, matchId, winnerId)` | Complete a match and place the winner in the next one. Refuses to overwrite a different winner on a done match. |
| `rollback(matches, matchId)` | Undo a result's downstream effects before re-entering it. |
| `liveBoard(matches, stage, poolOrder)` | "Now playing" by court and "up next" per pool or round. |

Run tests: `npm test -w @tournament/core`.

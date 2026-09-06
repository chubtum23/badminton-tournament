# @tournament/core

Pure tournament rules. No database, no UI, no runtime dependencies. Every function
takes plain objects in and returns new objects out; nothing is mutated.

Sport-specific behaviour lives in `Settings` (`gamesPerMatch`, `pointsPerGame`,
`winByTwo`, `maxPoints`). `BADMINTON_DEFAULTS` is best of 3 to 15, win by two, cap 21.

| Function | Purpose |
|---|---|
| `validateGame(settings, a, b)` | Is this a legal finished game score? Returns the winning side or a reason. |
| `matchResult(settings, games)` | Winner of a match from its games, or incomplete, or an error naming the bad game. |
| `assignPools(teamIds, poolCount, rng)` | Shuffle and deal teams into pools. Seeds are ignored on purpose. |
| `roundRobin(teamIds)` / `poolMatches(poolId, teamIds, newId)` | Every-team-plays-every-team schedule, as pairings or as ready `Match` rows. |
| `poolStandings(teams, matches, gamesByMatch)` | Table ordered by wins, point difference, head-to-head, name. |
| `buildBracket(poolResults, advancePerPool, newId)` | Single-elimination tree from pool finishing positions, with byes resolved and matches linked. |
| `advance(matches, matchId, winnerId)` | Complete a match and place the winner in the next one. |
| `rollback(matches, matchId)` | Undo a result's downstream effects before re-entering it. |
| `liveBoard(matches, stage, poolOrder)` | "Now playing" by court and "up next" per pool or round. |

Run tests: `npm test -w @tournament/core`.

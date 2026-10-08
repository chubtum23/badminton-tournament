# Knockout relay matches — design

Approved with the organiser 2026-10-08. Pool play is unchanged.

## The format

- A knockout match is **one relay game**: first team to the round's target wins.
- Targets: **quarter-finals 45, semi-finals 63, final 63**. Any earlier round (round of 16 and up)
  uses the quarter-final target.
- **Short deuce = next point wins**: at 44-44 the next rally ends it (45-44). So there is no
  win-by-two and no cap above the target.
- **No clock** in the knockout.
- Three legs, swapping the moment **either** team reaches a third of the target:
  leg 1 **Mixed #1**, leg 2 **Mixed #2**, leg 3 **Men's doubles** (the same three pairs as the pool
  games). For 45 the swaps are at 15 and 30; for 63 at 21 and 42.

## Rules page (Knockout stage)

- A **Relay** checkbox. When ticked the knockout is one relay game per match: games per match is 1,
  win-by-two off, no clock, and the points/cap/clock boxes are replaced by three target boxes:
  **Quarter-finals** (default 45), **Semi-finals** (63), **Final** (63).
- Each target must be a positive multiple of 3 (whole-number swap points).
- Editable under the existing rule: until the first knockout game is scored or put on court. Saving
  resizes the empty knockout game slots to one per match (existing `koSlotChanges` path).

## Rules engine

- The knockout's settings depend on the match's round, so every place that validates or labels a
  knockout game asks for that match's settings (round-aware), not one knockout-wide object.
- The number of knockout rounds is needed to tell a final from a semi; it comes from the bracket
  (largest knockout round), not from the match alone.
- A relay game validates as: integer scores, winner exactly on the target, loser below it. The
  existing `validateGame` with `pointsPerGame = target, winByTwo = false, maxPoints = null` already
  does this, and a time-expired score is refused because the knockout has no clock.
- Leg helper: `relayLeg(target, scoreA, scoreB)` → leg 1-3 (by the higher score: below a third,
  below two thirds, else leg 3), plus `justSwapped` when the higher score sits exactly on a swap
  point and the last rally took it there.

## Scoring surfaces

- **Typed score** (Matches page, team submission): one box pair, labelled "Relay to 45"/"Relay to
  63"; validated as above.
- **Tap-by-tap score sheet**: runs to the target. Row names show the pair currently on for each
  side and change at each swap; service carries on by the normal court rules, the incoming players
  taking the outgoing players' positions (player indices stay, only names change). On reaching a
  swap point a large orange banner shows **"SWAP — Mixed #2 on: <pair A> v <pair B>"** until the
  next rally is tapped.
- **Live page / hall screen** and **Matches page card**: each live knockout match shows
  "Leg n · <pair name>" with the live score, and a SWAP flag while `justSwapped`.
- **Labels**: the game is "Relay to <target>" wherever a game name is shown.
- **Power ratings**: after a relay game the scorer can rate all three players of each team.

## Out of scope

Golden point/sudden death variants beyond "next point wins", per-leg clocks, relay in the pools.

## Testing

Unit tests for the leg helper, round-aware settings, relay validation and the rules form. One
manual/e2e pass: set relay rules, start a 4-team knockout, score a semi on the tap sheet past 21 and
42 and see the banner, finish it, check the final asks for 63.

# Optional player photos (v1.5)

Addendum to `2026-09-08-team-signup-and-organiser-ux-design.md`. Where this document and the
earlier ones disagree, this one wins.

A team signs itself up by typing three names into three boxes. This spec lets each of those three
boxes carry an optional photo, uploaded in the same submit, shown as a circle ringed in the team's
colour.

## 0. Decisions made during brainstorming

| Question | Decision |
|---|---|
| Required? | Optional. A team with no photos signs up exactly as it does today. |
| When | At sign-up, and later from the private team link. Never mandatory. |
| Shape | A circle, ringed 3px in the team's colour. The only circles in a zero-radius design system, deliberately: a profile picture reads as one. |
| No photo | The same circle, filled with the team colour, initials in white. Rosters stay aligned whether or not anyone uploaded. |
| Live Photos | Nothing to decide. iOS hands a web file input the still frame only; the motion half never leaves the phone. |
| Animated avatars | Not allowed. GIF/WebP-animated/video fight the ring, cost bandwidth, and are harder to moderate. |
| Where shown | Team directory rosters and the team edit page. Not on match cards, standings or the live screen, which are read from across a hall. |
| Moderation | An organiser remove button on the admin Teams page. No pre-moderation. |

## 1. Bounds

The picked file is judged generously; what gets stored is small.

| Stage | Rule | Reason |
|---|---|---|
| Picked file | reject > 15 MB | A 48MP iPhone photo is ~10 MB. Nobody hits this taking a normal photo. |
| Picked file | reject < 2 KB | An icon or a truncated file, not a photo. |
| Decoded image | reject if either side < 96 px | Same. |
| Accepted types | `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif` | What phones produce. |
| Stored object | 512x512 JPEG, quality 0.82, ~60-100 KB | Sharp on a retina card, cheap to serve. |
| Server re-check | reject > 400 KB, or bytes not starting `FF D8 FF` | The client does the resizing, so the server must not trust that it did. |

HEIC is decoded by the browser or not at all. Safari decodes it; Chrome and Firefox do not. On a
failed decode the field says so and the sign-up continues without that photo. Bundling a WASM
decoder for a case iOS mostly avoids by converting to JPEG on pick is not worth ~500 KB.

## 2. Storage and schema

- Bucket `player-photos`: public read, no insert/update/delete for `anon` or `authenticated`.
  Every write is service-role, for the same reason `sign_up_team` is not granted to `anon` - the
  anon key ships in the browser bundle, and the only rate limiter lives in the server action.
- `players.photo_path text` (nullable). Object path `<tournament_id>/<player_id>.jpg`.
- `write_roster` deletes and recreates all three players on every roster edit. It captures
  `photo_path` per role before the delete and reinstates it after, so renaming a player keeps
  their photo. The durable slot in this schema is `(team, role)`, not the player row.
- `set_player_photo(p_player uuid, p_path text)` and `clear_player_photo(p_player uuid)`,
  service-role only, keep the writes in one place.

## 3. Flow

**Client** (`PhotoField`, one per roster box): on pick, validate size and type, decode to an
`Image`, centre-crop to a square, draw to a 512x512 canvas, `toBlob` as JPEG q0.82. The blob
replaces the file in a hidden input so the existing single-submit form is unchanged in shape. A
thumbnail with a remove button shows what will be uploaded.

**Server** (`signUpTeam`): unchanged up to and including the `sign_up_team` RPC. Then, for each of
the three optional blobs, re-check the bytes, upload to the bucket, and call `set_player_photo`.

A failed upload does **not** fail the sign-up. The team is already created; the action returns the
token with `photosFailed: true` and the team page says the photos did not save and offers the
field again. Losing a team because a photo upload timed out would be the worse failure.

**Later edits**: the same `PhotoField` sits in the team edit page's roster form, and
`updateMyRoster` handles added, replaced and removed photos. Replacing overwrites the same path
(the path is keyed by player id, so there is nothing to clean up). Removing deletes the object and
nulls the column.

**Organiser**: a remove control per player on the admin Teams page, calling the same clear path
under the organiser's own admin check.

## 4. Components

- `lib/photos/validate.ts` - pure: byte bounds, magic number, dimension bounds, crop maths.
  Shared by client and server, tested directly.
- `lib/photos/resize.ts` - browser only: decode, crop, encode. Thin wrapper over canvas.
- `lib/photos/storage.ts` - server only: upload, delete, public URL for a path.
- `components/PlayerAvatar.tsx` - the circle. Photo plus ring, or team colour plus initials.
- `components/PhotoField.tsx` - the picker, preview and remove button.

## 5. Testing

- Unit: `validate.ts` against each bound and a non-JPEG masquerading as one; initials derivation
  (one name, three names, non-Latin).
- Integration: sign up a team with one photo and none, against the local Supabase, asserting the
  object exists, the column is set, and a roster rename preserves both.
- No new e2e spec. The existing sign-up spec must keep passing untouched, which is the real
  assurance that photos stayed optional.

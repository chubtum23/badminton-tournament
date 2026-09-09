# Static assets

Files here are served from the site root: `public/gugc.jpg` is fetched as `/gugc.jpg`.

## `gugc.jpg` — the club crest

The club logo, shown in the navy band beside the title on every screen. It is the wide lockup —
the GUGC monogram and the club's name — trimmed to its own edges, because the header sizes it by
height and lets the width follow: 40px tall on a phone, 56px on a laptop.

Two things matter if it is ever replaced:

- **Trim the white space first.** The header adds its own padding, so any margin baked into the
  file shows up as a lopsided gap.
- **Keep it matted on white.** A JPEG has no transparency, so its white ground would sit on the
  navy as a rectangle regardless; the header makes that mat deliberate instead of accidental.

If the file is missing the crest hides itself rather than showing a broken image (see
`src/components/ClubLogo.tsx`), so the header stays intact either way.

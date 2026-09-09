# Static assets

Files here are served from the site root: `public/gugc.jpg` is fetched as `/gugc.jpg`.

## `gugc.jpg` — the club crest

Drop the club logo in here as `gugc.jpg` and it appears in the navy band beside the title on
every screen. Until the file exists the crest hides itself rather than showing a broken image
(see `src/components/ClubLogo.tsx`), so the header stays intact either way.

It is matted on bone at 48px on a phone and 64px on a laptop, so a roughly square image of at
least 128px works best.

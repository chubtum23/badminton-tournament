# Static assets

Files here are served from the site root: `public/gugc.png` is fetched as `/gugc.png`.

## `gugc.png` — the club crest

The club logo, shown in the navy band beside the title on every screen. It is the wide lockup — a
pixel-art shuttlecock and the GUGC letterform — trimmed to its own edges, because the header sizes
it by height and lets the width follow: 40px tall on a phone, 56px on a laptop.

Two things matter if it is ever replaced:

- **Trim the transparent margin first.** The header adds its own spacing, so any margin baked into
  the file shows up as a lopsided gap and shrinks the artwork inside its own box.
- **Keep the alpha channel.** The crest sits directly on the navy with no plate behind it. A format
  without transparency (a JPEG, say) would show its ground as a rectangle in the band, which is the
  problem this file was made to solve — so don't reintroduce a mat to work around one.

If the file is missing the crest hides itself rather than showing a broken image (see
`src/components/ClubLogo.tsx`), so the header stays intact either way.

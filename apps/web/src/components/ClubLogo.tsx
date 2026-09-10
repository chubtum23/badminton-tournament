'use client';

import { useState } from 'react';

/**
 * The club crest, to the left of the title in the navy band.
 *
 * The artwork is a wide pixel-art lockup — a shuttlecock breaking up into loose pixels, then the
 * GUGC letterform — trimmed to its own edges, so it is sized by height and left to take whatever
 * width that gives it. It carries a real alpha channel and sits directly on the navy: no mat, no
 * plate, no rectangle. That is the whole point of the PNG, so resist wrapping it in a background.
 *
 * It is deliberately left to scale smoothly rather than with `image-rendering: pixelated`. The
 * source blocks are ~26px square and land at ~4px in the header, and nearest-neighbour at that
 * ratio drops whole rows of pixels and ruins the letterforms; the browser's own filtering keeps
 * the blocks square and the edges clean.
 *
 * If the file is missing the crest removes itself rather than leaving a broken-image glyph in the
 * band: the header is the first thing on every screen and must never look damaged.
 */
export function ClubLogo() {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a static public asset needs no
    // optimisation pipeline, and next/image cannot fail quietly the way this does.
    <img
      data-testid="club-logo"
      src="/gugc.png"
      alt="Griffith University Gold Coast Badminton Club"
      width={1064}
      height={347}
      onError={() => setMissing(true)}
      className="block h-10 w-auto shrink-0 sm:h-14"
    />
  );
}

'use client';

import { useState } from 'react';

/**
 * The club crest, to the left of the title in the navy band.
 *
 * The artwork is a wide lockup — the GUGC monogram and the club's name — trimmed to its own edges,
 * so it is sized by height and left to take whatever width that gives it. It is a JPEG and carries
 * an opaque white background, so it is matted on white rather than floated on the navy, which would
 * show as a white rectangle with a hard edge either way; better to make the mat deliberate.
 *
 * If the file is missing the crest removes itself rather than leaving a broken-image glyph in the
 * band: the header is the first thing on every screen and must never look damaged.
 */
export function ClubLogo() {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return (
    <span data-testid="club-logo" className="shrink-0 bg-white px-2.5 py-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static public asset needs no
          optimisation pipeline, and next/image cannot fail quietly the way this does. */}
      <img
        src="/gugc.jpg"
        alt="Griffith University Gold Coast Badminton Club"
        width={924}
        height={528}
        onError={() => setMissing(true)}
        className="block h-10 w-auto sm:h-14"
      />
    </span>
  );
}

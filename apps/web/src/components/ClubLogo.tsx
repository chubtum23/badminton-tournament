'use client';

import { useState } from 'react';

/**
 * The club crest, to the left of the title in the navy band.
 *
 * The file is a plain JPEG dropped into `public/`, so it carries its own opaque background. It is
 * therefore matted on bone rather than floated on the navy, which would show as a white rectangle
 * with a hard edge either way — better to make the mat deliberate and give it the same 2px navy
 * frame every card in the design wears.
 *
 * If the file is not there the crest removes itself rather than leaving a broken-image glyph in
 * the band: the header is the first thing on every screen and must never look damaged.
 */
export function ClubLogo() {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  return (
    <span data-testid="club-logo" className="shrink-0 border-2 border-bone/25 bg-bone p-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static public asset needs no
          optimisation pipeline, and next/image cannot fail quietly the way this does. */}
      <img
        src="/gugc.jpg"
        alt="Griffith University Gold Coast badminton club"
        width={64}
        height={64}
        onError={() => setMissing(true)}
        className="block h-12 w-12 object-contain sm:h-16 sm:w-16"
      />
    </span>
  );
}

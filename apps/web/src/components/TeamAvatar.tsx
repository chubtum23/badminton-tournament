import { initialsOf, inkOn, publicPhotoUrl } from '@/lib/photos/rules';

/**
 * A team's face, or its initials when there is no photo. The only circle in a zero-radius design
 * system, deliberately: a profile picture reads as one, and the team's own colour ringing it ties
 * it back to that team at a glance.
 *
 * A plain <img> rather than next/image, for the same reason as ClubLogo: these are already 512px
 * JPEGs of about 80 KB served from Supabase's CDN, so the optimisation pipeline adds a hop and
 * buys nothing.
 */
export function TeamAvatar({ teamName, colour, path, size = 40 }: {
  teamName: string; colour: string; path: string | null; size?: number;
}) {
  // The ring is the team's colour, so it has to stay visible at 24px in a standings row without
  // eating the photo at that size. Three pixels is right for the big ones, two for the rest.
  const box = { width: size, height: size, borderColor: colour, borderWidth: size >= 36 ? 3 : 2 };
  if (!path) {
    return (
      <span aria-hidden style={{ ...box, background: colour, color: inkOn(colour), fontSize: Math.round(size * 0.36) }}
        className="inline-flex shrink-0 items-center justify-center rounded-full border-solid font-display font-black leading-none">
        {initialsOf(teamName)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- as in ClubLogo: an already-optimised
    // 512px CDN-served JPEG gains nothing from next/image's pipeline.
    <img src={publicPhotoUrl(path)} alt="" loading="lazy" style={box}
      className="inline-block shrink-0 rounded-full border-solid bg-line-soft object-cover" />
  );
}

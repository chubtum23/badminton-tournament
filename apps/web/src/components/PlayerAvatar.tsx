import { initialsOf, inkOn, publicPhotoUrl } from '@/lib/photos/rules';

/**
 * A player's face, or their initials when there is no photo. The only circle in a zero-radius
 * design system, deliberately: a profile picture reads as one, and the team colour ringing it
 * ties a player back to their team at a glance.
 *
 * A plain <img> rather than next/image, for the same reason as ClubLogo: these are already 512px
 * JPEGs of about 80 KB served from Supabase's CDN, so the optimisation pipeline adds a hop and
 * buys nothing.
 */
export function PlayerAvatar({ name, colour, path, size = 40 }: {
  name: string; colour: string; path: string | null; size?: number;
}) {
  const box = { width: size, height: size, borderColor: colour };
  if (!path) {
    return (
      <span aria-hidden style={{ ...box, background: colour, color: inkOn(colour), fontSize: Math.round(size * 0.36) }}
        className="inline-flex shrink-0 items-center justify-center rounded-full border-[3px] font-display font-black leading-none">
        {initialsOf(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- as in ClubLogo: an already-optimised
    // 512px CDN-served JPEG gains nothing from next/image's pipeline.
    <img src={publicPhotoUrl(path)} alt="" loading="lazy" style={box}
      className="inline-block shrink-0 rounded-full border-[3px] bg-line-soft object-cover" />
  );
}

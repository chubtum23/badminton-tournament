export interface ProfileInput { name: string; tagline: string; colour: string; description: string }

/**
 * The character ceilings, shared by the sign-up form, the team edit form and the checks below, so a
 * box can never take more than the parser — and the matching check inside sign_up_team — will keep.
 */
export const PROFILE_LIMITS = { name: 40, tagline: 80, description: 400 } as const;

export function parseProfileForm(fd: FormData): { ok: true; value: ProfileInput } | { ok: false; problems: string[] } {
  const name = String(fd.get('name') ?? '').trim();
  const tagline = String(fd.get('tagline') ?? '').trim();
  const colour = String(fd.get('colour') ?? '').trim().toLowerCase();
  const description = String(fd.get('description') ?? '').trim();
  const problems: string[] = [];
  if (name.length < 1 || name.length > PROFILE_LIMITS.name) problems.push(`name must be 1-${PROFILE_LIMITS.name} characters`);
  if (tagline.length > PROFILE_LIMITS.tagline) problems.push(`tagline must be at most ${PROFILE_LIMITS.tagline} characters`);
  if (!/^#[0-9a-f]{6}$/.test(colour)) problems.push('colour must look like #1a2b3c');
  if (description.length > PROFILE_LIMITS.description) problems.push(`description must be at most ${PROFILE_LIMITS.description} characters`);
  return problems.length ? { ok: false, problems } : { ok: true, value: { name, tagline, colour, description } };
}

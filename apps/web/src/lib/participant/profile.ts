export interface ProfileInput { name: string; tagline: string; colour: string; description: string }

export function parseProfileForm(fd: FormData): { ok: true; value: ProfileInput } | { ok: false; problems: string[] } {
  const name = String(fd.get('name') ?? '').trim();
  const tagline = String(fd.get('tagline') ?? '').trim();
  const colour = String(fd.get('colour') ?? '').trim().toLowerCase();
  const description = String(fd.get('description') ?? '').trim();
  const problems: string[] = [];
  if (name.length < 1 || name.length > 40) problems.push('name must be 1-40 characters');
  if (tagline.length > 80) problems.push('tagline must be at most 80 characters');
  if (!/^#[0-9a-f]{6}$/.test(colour)) problems.push('colour must look like #1a2b3c');
  if (description.length > 400) problems.push('description must be at most 400 characters');
  return problems.length ? { ok: false, problems } : { ok: true, value: { name, tagline, colour, description } };
}

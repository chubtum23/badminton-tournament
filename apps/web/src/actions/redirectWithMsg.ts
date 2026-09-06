import { redirect } from 'next/navigation';
import type { ActionResult } from './errors';

/** Redirects to `path?msg=...` (preserving any query already in `path`) with the success text or the action's error. */
export function redirectWithMsg(path: string, result: ActionResult<unknown>, okMessage: string): never {
  const msg = result.ok ? okMessage : result.message ?? result.error;
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}msg=${encodeURIComponent(msg)}`);
}

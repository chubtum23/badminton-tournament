import { redirect } from 'next/navigation';
import type { ActionResult } from './errors';

/** Redirects to `path?msg=...` (preserving any query already in `path`) with the success text or the action's error. */
export function redirectWithMsg(path: string, result: ActionResult<unknown>, okMessage: string): never {
  const msg = result.ok ? okMessage : result.message ?? result.error;
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}msg=${encodeURIComponent(msg)}`);
}

/**
 * For a page reached from somewhere else and finished with once saved: a success goes back to
 * `backPath` carrying the message, a failure stays on `path` so the error is read beside the form
 * that caused it rather than on a screen the organiser has already left.
 */
export function redirectBackOnSuccess(path: string, backPath: string, result: ActionResult<unknown>, okMessage: string): never {
  return redirectWithMsg(result.ok ? backPath : path, result, okMessage);
}

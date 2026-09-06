export type ActionError =
  | 'invalid_score' | 'match_not_editable' | 'not_your_match' | 'stale_state'
  | 'not_admin' | 'invalid_settings' | 'invalid_input' | 'not_participant';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError; message?: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = <T = void>(error: ActionError, message?: string): ActionResult<T> => ({ ok: false, error, message });

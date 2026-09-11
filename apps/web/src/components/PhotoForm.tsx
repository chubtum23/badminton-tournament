'use client';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { PhotoBusyContext } from './PhotoField';
import { SubmitButton } from './SubmitButton';
import { ui } from './ui';

/**
 * A server-action form with a PhotoField in it. Two things a plain `<form action>` cannot do:
 *
 * - hold the submit while the photo is still being resized, so the save never races the resize;
 * - catch an action that throws (a dropped connection, a body the server refused) and say so under
 *   the button. Uncaught, it would take the whole page down to the error boundary and lose the
 *   typing. Navigation (the action's own `?msg=` redirect) is passed through untouched.
 *
 * The submit button is rendered here because it is what the busy state disables.
 */
export function PhotoForm({ action, className, footerClassName, submitLabel, children }: {
  action: (formData: FormData) => Promise<void>;
  className?: string;
  /** Wraps the submit button and the error line, e.g. to span a grid row. */
  footerClassName?: string;
  submitLabel: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const reportBusy = useCallback((b: boolean) => { busyRef.current = b; setBusy(b); }, []);
  return (
    <PhotoBusyContext.Provider value={reportBusy}>
      <form
        className={className}
        action={async (fd) => {
          if (busyRef.current) { setError('Wait for the photo to finish, then save'); return; }
          setError(null);
          try {
            await action(fd);
          } catch (err) {
            unstable_rethrow(err);
            setError('Could not save; check your connection and try again');
          }
        }}
      >
        {children}
        <div className={footerClassName}>
          <SubmitButton className={ui.primary} disabled={busy}>{submitLabel}</SubmitButton>
          {error && <p role="alert" className={`${ui.alarm} mt-3`}>{error}</p>}
        </div>
      </form>
    </PhotoBusyContext.Provider>
  );
}

'use client';
import { useFormStatus } from 'react-dom';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/**
 * A submit button that shows the form's own progress.
 *
 * `useFormStatus` reports the pending state of the form this button sits inside, so every
 * form gets a spinner and a disabled button for free while its server action runs, without
 * any per-page state. The label is left alone on purpose: the accessible name stays stable
 * for screen readers and for the end-to-end tests that find buttons by their text.
 *
 * `confirmMessage` replaces the separate ConfirmButton for destructive actions.
 */
export function SubmitButton({ children, className, confirmMessage, onClick, ...rest }: Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'className' | 'onClick' | 'type'> & {
  children: ReactNode;
  className?: string;
  /** When set, the click is gated behind a window.confirm() with this text. */
  confirmMessage?: string;
  onClick?: ComponentPropsWithoutRef<'button'>['onClick'];
}) {
  const { pending } = useFormStatus();
  // `disabled` sits after the spread so a caller's own reason to disable the button (a hub action
  // whose preconditions are not met) survives, and combines with the form's pending state.
  return (
    <button
      type="submit"
      aria-busy={pending}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) { e.preventDefault(); return; }
        onClick?.(e);
      }}
      className={`inline-flex items-center justify-center gap-1.5 disabled:cursor-wait disabled:opacity-60 ${className ?? ''}`}
      {...rest}
      disabled={pending || rest.disabled}
    >
      {pending && (
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

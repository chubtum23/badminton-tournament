'use client';
import { useState } from 'react';
import { ui } from './ui';

/**
 * A destructive action in two taps: the button, then the question and a plain Yes.
 *
 * Used instead of `SubmitButton`'s window.confirm where the action deserves to be read rather than
 * dismissed — the consequence is spelled out in the page, in the same type as everything else,
 * where a browser dialog on a phone is a grey box people tap through. It is also why the action
 * does not hide behind a disclosure: an organiser should be able to see the thing they came for.
 *
 * The trigger is a plain button, so before the page's JavaScript loads it does nothing at all
 * rather than submitting the form unconfirmed.
 */
export function ConfirmStep({ label, className, question, children }: {
  /** The idle button's label. */
  label: string;
  className: string;
  /** What is about to happen, spelled out. */
  question: string;
  /** The Yes button (a SubmitButton), and any hidden fields it needs to carry. */
  children: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" data-testid="confirm-arm" onClick={() => setArmed(true)} className={className}>{label}</button>
    );
  }
  return (
    <div data-testid="confirm-step" className="space-y-3">
      <p className="text-[15px] font-semibold text-red-800" role="alert">{question}</p>
      <div className="flex flex-wrap items-center gap-2.5">
        {children}
        <button type="button" data-testid="confirm-cancel" onClick={() => setArmed(false)} className={ui.secondary}>Cancel</button>
      </div>
    </div>
  );
}

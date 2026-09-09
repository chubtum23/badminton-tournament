'use client';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/actions/errors';
import { RosterFields } from './RosterFields';
import { ui } from './ui';

/** "(optional)" inside an uppercase label reads as shouting, so it drops back to plain case. */
const optional = 'font-normal normal-case tracking-normal text-muted';

/**
 * Calls the sign-up action itself so a rejected attempt keeps everything typed, then does a full
 * navigation to the one-time link: that route sets the httpOnly team cookie and lands on the team
 * page, which a client-side push could not do.
 */
export function JoinForm({ slug, needsCode, action }: {
  slug: string; needsCode: boolean;
  action: (formData: FormData) => Promise<ActionResult<{ token: string }>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-10"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          // A dropped connection or a server error rejects the promise rather than returning a
          // result, and without this the form would just sit there looking like nothing happened.
          let r;
          try {
            r = await action(fd);
          } catch {
            setError('Could not sign up; please try again.');
            return;
          }
          if (!r.ok) { setError(r.message ?? r.error); return; }
          window.location.assign(`/t/${slug}/team/${r.data.token}?welcome=1`);
        });
      }}
    >
      {error && <p role="alert" data-testid="signup-error" className={ui.alarm}>{error}</p>}

      {/* Name, tagline and colour are one short line each, so on a wide screen they sit three
          across rather than leaving half the card empty. The description spans the row under them. */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <label className={ui.labelLg}>Team name<input name="name" required maxLength={40} className={ui.fieldLg} placeholder="e.g. Net Ninjas" /></label>
        <label className={ui.labelLg}>Tagline <span className={optional}>(optional)</span><input name="tagline" maxLength={80} className={ui.fieldLg} /></label>
        <label className={ui.labelLg}>Team colour<input name="colour" type="color" defaultValue="#2B3390" className="mt-2.5 h-[62px] w-full cursor-pointer border-hair border-line bg-white p-1.5" /></label>
        <label className={`${ui.labelLg} md:col-span-2 xl:col-span-3`}>About your team <span className={optional}>(optional)</span>
          <textarea name="description" maxLength={400} rows={3} className={`${ui.fieldLg} resize-y font-normal normal-case tracking-normal`} />
        </label>
      </div>

      <RosterFields big />

      {needsCode && (
        <label className={`${ui.labelLg} block max-w-md`}>Join code<input name="joinCode" required className={ui.fieldLg} />
          <span className={`${ui.help} text-base`}>The organiser gave this to club members.</span>
        </label>
      )}
      <button type="submit" disabled={pending} aria-busy={pending} className={`${ui.primary} w-full px-10 py-5 text-base disabled:opacity-60 sm:w-auto`}>
        {pending ? 'Signing up…' : 'Sign our team up'}
      </button>
    </form>
  );
}

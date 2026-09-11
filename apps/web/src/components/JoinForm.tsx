'use client';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/actions/errors';
import { PROFILE_LIMITS } from '@/lib/participant/profile';
import { LimitedField } from './LimitedField';
import { PhotoBusyContext, PhotoField } from './PhotoField';
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
  // Set once the team exists. The full navigation that follows takes a moment, and a second tap in
  // that window would try to sign the same team up again.
  const [done, setDone] = useState(false);
  // A photo still being resized: the form waits for it rather than posting without it.
  const [photoBusy, setPhotoBusy] = useState(false);
  const [colour, setColour] = useState('#2B3390');
  // Mirrors the name box so the placeholder circle carries the team's initials as they type it.
  const [name, setName] = useState('');
  const busy = pending || done;
  return (
    <PhotoBusyContext.Provider value={setPhotoBusy}>
    <form
      className="space-y-10"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || photoBusy) return;
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
          setDone(true);
          window.location.assign(`/t/${slug}/team/${r.data.token}?welcome=1`);
        });
      }}
    >
      {error && <p role="alert" data-testid="signup-error" className={ui.alarm}>{error}</p>}

      {/* Name, tagline and colour are one short line each, so on a wide screen they sit three
          across rather than leaving half the card empty. The description spans the row under them. */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <label className={ui.labelLg}>Team name<LimitedField name="name" required limit={PROFILE_LIMITS.name} className={ui.fieldLg} onValueChange={setName} /></label>
        <label className={ui.labelLg}>Tagline <span className={optional}>(optional)</span><LimitedField name="tagline" limit={PROFILE_LIMITS.tagline} className={ui.fieldLg} /></label>
        <label className={ui.labelLg}>Team colour<input name="colour" type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="colour-dot mt-2.5 block" /></label>
        <label className={ui.labelLg}>Team photo <span className={optional}>(optional)</span>
          <PhotoField teamName={name} colour={colour} currentPath={null} />
        </label>
        <label className={`${ui.labelLg} md:col-span-2 xl:col-span-3`}>About your team <span className={optional}>(optional)</span>
          <LimitedField name="description" limit={PROFILE_LIMITS.description} rows={3} className={`${ui.fieldLg} resize-y font-normal normal-case tracking-normal`} />
        </label>
      </div>

      <RosterFields big />

      {needsCode && (
        <label className={`${ui.labelLg} block max-w-md`}>Join code
          {/* A code is typed exactly, so the phone must not capitalise or "correct" it. */}
          <input name="joinCode" required autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} className={ui.fieldLg} />
          <span className={`${ui.help} text-base`}>The organiser gave this to club members.</span>
        </label>
      )}
      <button type="submit" disabled={busy || photoBusy} aria-busy={busy} className={`${ui.primary} w-full px-10 py-5 text-base disabled:opacity-60 sm:w-auto`}>
        {busy ? 'Signing up…' : 'Sign our team up'}
      </button>
      {photoBusy && !busy && <p className={`${ui.help} -mt-7`}>Finishing your photo…</p>}
    </form>
    </PhotoBusyContext.Provider>
  );
}

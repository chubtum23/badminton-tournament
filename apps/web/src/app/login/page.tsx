import { signIn } from './actions';
import { SubmitButton } from '@/components/SubmitButton';
import { PlainShell } from '@/components/Shell';
import { ui } from '@/components/ui';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <PlainShell title="Organiser sign in" status="GUGC tournament desk">
      <div className={`${ui.card} max-w-sm`}>
        <div className={`${ui.head} ${ui.headOrange}`}>
          <span className={ui.eyebrow}>Sign in</span>
        </div>
        <div className={`${ui.body} space-y-5`}>
          {error && <p role="alert" className={ui.alarm}>{error}</p>}
          <form action={signIn} className="space-y-4">
            <label className={ui.label}>Email
              <input name="email" type="email" required autoComplete="email" className={ui.field} />
            </label>
            <label className={ui.label}>Password
              <input name="password" type="password" required autoComplete="current-password" className={ui.field} />
            </label>
            <SubmitButton className={`${ui.primary} w-full`}>Sign in</SubmitButton>
          </form>
          <p className={ui.help}>Organiser accounts are created in the Supabase dashboard (Authentication → Users) for v1.</p>
        </div>
      </div>
    </PlainShell>
  );
}

import { signIn } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-bold">Admin sign in</h1>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <form action={signIn} className="space-y-3">
        <label className="block text-sm">Email
          <input name="email" type="email" required className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block text-sm">Password
          <input name="password" type="password" required className="mt-1 w-full rounded border p-2" />
        </label>
        <button className="w-full rounded bg-slate-900 p-2 text-white">Sign in</button>
      </form>
      <p className="text-xs text-slate-500">Admins are created in the Supabase dashboard (Authentication → Users) for v1.</p>
    </main>
  );
}

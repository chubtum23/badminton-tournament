'use server';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const sb = await createServerSupabase();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect('/admin');
}

export async function signOut(): Promise<void> {
  const sb = await createServerSupabase();
  await sb.auth.signOut();
  redirect('/login');
}

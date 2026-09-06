import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { getTournamentBySlug } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export default async function PublicLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await createServerSupabase();
  const t = await getTournamentBySlug(sb, slug);
  if (!t) notFound();
  const tabs = [['', 'Live'], ['/pools', 'Pools'], ['/bracket', 'Bracket']] as const;
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t.name}</h1>
        <p className="text-xs uppercase tracking-wide text-slate-500">{t.status === 'setup' ? 'Starting soon' : t.status === 'pools' ? 'Pool stage' : t.status === 'knockout' ? 'Knockout' : 'Finished'}</p>
      </header>
      <nav className="flex gap-2 border-b">
        {tabs.map(([path, label]) => <Link key={label} href={`/t/${slug}${path}`} className="px-3 py-2 text-sm hover:bg-slate-100">{label}</Link>)}
      </nav>
      {children}
    </div>
  );
}

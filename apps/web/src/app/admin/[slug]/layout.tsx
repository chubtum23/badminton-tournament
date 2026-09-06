import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/actions/guard';
import { signOut } from '@/app/login/actions';

const tabs = [
  ['', 'Setup'], ['/pools', 'Pools'], ['/matches', 'Matches'], ['/bracket', 'Bracket'],
] as const;

export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAdmin(slug);
  if ('error' in ctx) redirect('/login');
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{ctx.tournament.name}</h1>
          <p className="text-xs text-slate-500">Admin · status: {ctx.tournament.status} · <Link className="underline" href={`/t/${slug}`}>public page</Link></p>
        </div>
        <form action={signOut}><button className="text-sm underline">Sign out</button></form>
      </header>
      <nav className="flex gap-2 border-b">
        {tabs.map(([path, label]) => (
          <Link key={label} href={`/admin/${slug}${path}`} className="px-3 py-2 text-sm hover:bg-slate-100">{label}</Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

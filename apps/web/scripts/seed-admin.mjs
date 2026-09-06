// Creates the local development admin user through the service role. Idempotent.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local'); process.exit(1); }

const email = process.env.E2E_ADMIN_EMAIL ?? 'admin@local.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'local-admin-pass';
const sb = createClient(url, key, { auth: { persistSession: false } });
const existing = await sb.auth.admin.listUsers({ perPage: 1000 });
if (existing.error) throw existing.error;
if (existing.data.users.some((u) => u.email === email)) {
  console.log(`admin ${email} already exists`);
} else {
  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  console.log(`created admin ${email}`);
}

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMemoryClient, signInWithPassword, type Database } from '@fyspoti/library';

export function integrationConfig() {
  const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key, SUPABASE_TEST_ADMIN_KEY: adminKey, SUPABASE_TEST_TARGET: target, SUPABASE_TEST_PROJECT_REF: ref } = process.env;
  if (!url || !key || !adminKey || !target) throw new Error('Configure the integration target; tests are never silently skipped.');
  const endpoint = new URL(url);
  if (target === 'local' ? !['127.0.0.1', 'localhost'].includes(endpoint.hostname)
    : target !== 'hosted' || !ref || endpoint.protocol !== 'https:' || endpoint.hostname !== `${ref}.supabase.co`) throw new Error('Integration target mismatch.');
  return { url, key, adminKey, target };
}

export interface AccountFixture {
  id: string;
  client: SupabaseClient<Database>;
  fresh(): Promise<SupabaseClient<Database>>;
}
export interface TestAccounts {
  config: ReturnType<typeof integrationConfig>;
  admin: SupabaseClient<Database>;
  provision(label: string): Promise<AccountFixture>;
  cleanup(): Promise<void>;
}

export function testAccounts(): TestAccounts {
  const config = integrationConfig();
  const admin = createClient<Database>(config.url, config.adminKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const ids: string[] = [];
  const clients: SupabaseClient<Database>[] = [];
  const run = randomUUID();
  const password = `Fys-${randomUUID()}-test!`;
  async function provision(label: string) {
    const email = `fyspoti-${label}-${run}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`Auth fixture provisioning failed: ${error?.code ?? 'missing user'}`);
    ids.push(data.user.id);
    const fresh = async () => {
      const client = createMemoryClient(config.url, config.key); clients.push(client);
      await signInWithPassword(client, email, password);
      return client;
    };
    return { id: data.user.id, client: await fresh(), fresh };
  }
  return { config, admin, provision,
    async cleanup() {
      const failures: string[] = [];
      for (const client of clients) { client.auth.stopAutoRefresh(); await client.auth.signOut({ scope: 'local' }); }
      for (const id of ids) { if ((await admin.auth.admin.deleteUser(id)).error) failures.push(id); }
      if (failures.length) throw new Error(`Could not remove synthetic users: ${failures.join(', ')}`);
    },
  };
}

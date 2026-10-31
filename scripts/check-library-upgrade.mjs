import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// A disposable database inside this project's local container; never targets hosted data.
const container = 'supabase_db_fyspoti-p3';
const database = `fyspoti_upgrade_${randomUUID().replaceAll('-', '')}`;
if (!/^fyspoti_upgrade_[a-f0-9]{32}$/.test(database)) throw new Error('Invalid upgrade database name.');
function sql(query, target = database) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', target, '-v', 'ON_ERROR_STOP=1'], {
    input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}
let created = false;
try {
  sql(`create database ${database};`, 'postgres'); created = true;
  const original = readFileSync('services/cloud/supabase/migrations/20261031033217_create_private_playlists.sql', 'utf8');
  const upgrade = readFileSync('services/cloud/supabase/migrations/20261031043416_connected_core_library.sql', 'utf8');
  const profiles = readFileSync('services/cloud/supabase/migrations/20261031051447_desktop_accounts_profiles.sql', 'utf8');
  const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const playlist = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const item = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  sql(`create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    ${original}
    insert into auth.users values('${actor}');
    insert into public.playlists(id, owner_id, title) values('${playlist}', '${actor}', 'Preserve me');
    insert into public.playlist_items(id, playlist_id, track_id, ordering_key, snapshot_title, snapshot_artist_names, snapshot_duration_ms)
      values('${item}', '${playlist}', '11111111-1111-4111-8111-111111111111', 10, 'Original snapshot', ARRAY['Fixture Artist'], 12345);
    ${upgrade}
    ${profiles}
    do $$ begin
      if not exists(select 1 from public.playlist_items where id='${item}' and playlist_id='${playlist}'
        and track_id='11111111-1111-4111-8111-111111111111' and ordering_key=10
        and snapshot_title='Original snapshot' and snapshot_duration_ms=12345) then
        raise exception 'Upgrade changed existing item identity or metadata';
      end if;
      if not exists(select 1 from public.playlists where id='${playlist}' and revision=1 and title='Preserve me' and deleted_at is null) then
        raise exception 'Upgrade changed existing playlist';
      end if;
    end $$;
    select set_config('request.jwt.claim.sub', '${actor}', false);
    set role authenticated;
    select public.profile_mutate('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${actor}', 0, 'Listener');
    select public.library_mutate('remove_item', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      '{"accountId":"${actor}","playlistId":"${playlist}","itemId":"${item}","expectedRevision":1}');
    reset role;
    do $$ begin
      if not exists(select 1 from library_private.item_tombstones where item_id='${item}' and revision=2 and owner_id='${actor}') then
        raise exception 'Removal tombstone missing';
      end if;
      if exists(select 1 from public.playlist_items where id='${item}') then raise exception 'Removed item still active'; end if;
      if has_table_privilege('authenticated', 'public.playlists', 'INSERT') then raise exception 'Direct writes remain enabled'; end if;
      if not exists(select 1 from public.profiles where id='${actor}' and display_name='Listener' and revision=1) then raise exception 'Profile initialization failed'; end if;
      if has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then raise exception 'Direct profile writes enabled'; end if;
    end $$;`);
  console.log('Populated Part 1 → Part 2B upgrade passed; identities, snapshots, authorization, tombstones and profiles verified.');
} catch (error) {
  console.error('Local upgrade check failed:', error.stderr?.toString() ?? error.message);
  process.exitCode = 1;
} finally {
  if (created) sql(`drop database ${database};`, 'postgres');
}

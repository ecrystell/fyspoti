-- Forward-only upgrade of Part 1. Keep catalog IDs opaque; entity IDs remain UUIDs.
alter table public.playlist_items alter column track_id type text using track_id::text;
alter table public.playlists add column revision integer not null default 1 check (revision > 0);
alter table public.playlists add column deleted_at timestamptz;
alter table public.playlist_items drop constraint playlist_items_playlist_order_key;
alter table public.playlist_items add constraint playlist_items_playlist_order_key
  unique (playlist_id, ordering_key) deferrable initially immediate;

create schema if not exists library_private;
revoke all on schema library_private from public, anon, authenticated;
grant usage on schema library_private to authenticated;

create function library_private.valid_track_id(value text) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select value is not null and char_length(value) between 1 and 256
    and value = btrim(value) and value !~ '[[:space:]/\\]'
    and value !~* '^(https?:|file:|local:|p2-media:|spotify:|[a-z]:)';
$$;
revoke all on function library_private.valid_track_id(text) from public, anon;
grant execute on function library_private.valid_track_id(text) to authenticated;
alter table public.playlist_items add constraint playlist_items_canonical_id
  check (library_private.valid_track_id(track_id));

create table public.track_likes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null check (library_private.valid_track_id(track_id)),
  liked boolean not null,
  revision integer not null default 1 check (revision > 0),
  snapshot_title text not null check (char_length(snapshot_title) between 1 and 500),
  snapshot_artist_names text[] not null,
  snapshot_duration_ms integer not null check (snapshot_duration_ms between 0 and 86400000),
  unique (owner_id, track_id)
);
create index track_likes_owner_id_id_idx on public.track_likes(owner_id, id);
alter table public.track_likes enable row level security;
revoke all on public.track_likes from anon, authenticated;
grant select on public.track_likes to authenticated;
grant all on public.track_likes to service_role;
create policy track_likes_owner_select on public.track_likes for select to authenticated
  using (owner_id = (select auth.uid()));

create table library_private.mutation_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, mutation_id)
);
create table library_private.item_tombstones (
  item_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  revision integer not null,
  deleted_at timestamptz not null default now()
);
create index item_tombstones_owner_idx on library_private.item_tombstones(owner_id);
create index item_tombstones_playlist_idx on library_private.item_tombstones(playlist_id);
alter table library_private.mutation_receipts enable row level security;
alter table library_private.item_tombstones enable row level security;
-- No client table grants/policies: only the explicitly authorized definer below writes these.
revoke all on library_private.mutation_receipts, library_private.item_tombstones from public, anon, authenticated;

revoke insert, update, delete on public.playlists, public.playlist_items from authenticated;
drop policy playlists_owner_insert on public.playlists;
drop policy playlist_items_owner_insert on public.playlist_items;
alter policy playlists_owner_select on public.playlists
  using (owner_id = (select auth.uid()) and deleted_at is null);
-- Existing item SELECT checks the parent; its RLS now hides soft-deleted collections.

-- SQL-side validation is essential: callers can bypass TypeScript and invoke RPC directly.
create function library_private.validate_snapshot(snapshot jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(snapshot) is distinct from 'object'
     or jsonb_typeof(snapshot->'title') is distinct from 'string'
     or char_length(snapshot->>'title') not between 1 and 500
     or btrim(snapshot->>'title') = ''
     or jsonb_typeof(snapshot->'artistNames') is distinct from 'array'
     or jsonb_typeof(snapshot->'durationMs') is distinct from 'number' then
    raise sqlstate 'PT400' using message = 'Invalid metadata snapshot';
  end if;
  if jsonb_array_length(snapshot->'artistNames') not between 1 and 50
     or exists (select 1 from jsonb_array_elements(snapshot->'artistNames') a
       where jsonb_typeof(a) <> 'string' or char_length(a #>> '{}') not between 1 and 500 or btrim(a #>> '{}') = '')
     or (snapshot->>'durationMs')::numeric not between 0 and 86400000
     or trunc((snapshot->>'durationMs')::numeric) <> (snapshot->>'durationMs')::numeric then
    raise sqlstate 'PT400' using message = 'Invalid metadata snapshot';
  end if;
end;
$$;
revoke all on function library_private.validate_snapshot(jsonb) from public, anon, authenticated;

create function library_private.mutate(operation text, mutation_id uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  requested jsonb := jsonb_build_object('operation', operation, 'payload', payload);
  receipt library_private.mutation_receipts%rowtype;
  collection public.playlists%rowtype;
  entry public.playlist_items%rowtype;
  liked_track public.track_likes%rowtype;
  snapshot jsonb;
  artists text[];
  output jsonb;
  target uuid;
  ordered_ids uuid[];
  position integer;
begin
  if actor is null or not exists(select 1 from auth.users where id = actor) then
    raise sqlstate 'PT401' using message = 'Authentication required';
  end if;
  if mutation_id is null or jsonb_typeof(payload) is distinct from 'object' or operation is null
     or operation not in ('create','insert_item','rename','remove_item','reorder','delete','like') then
    raise sqlstate 'PT400' using message = 'Invalid mutation';
  end if;
  if payload->>'accountId' is distinct from actor::text then
    raise sqlstate 'PT401' using message = 'Account changed';
  end if;
  -- Account-level lock makes receipt lookup/insert and likes replay atomic, even for
  -- concurrent requests with one operation ID targeting different entities.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select * into receipt from library_private.mutation_receipts r
    where r.owner_id = actor and r.mutation_id = mutate.mutation_id;
  if found then
    if receipt.request <> requested then
      raise sqlstate 'PT409' using message = 'Mutation ID already used with different contents';
    end if;
    return receipt.response;
  end if;

  if operation in ('insert_item','like') then
    if jsonb_typeof(payload->'trackId') is distinct from 'string'
       or not library_private.valid_track_id(payload->>'trackId') then
      raise sqlstate 'PT400' using message = 'Invalid canonical track ID';
    end if;
    snapshot := payload->'metadataSnapshot';
    perform library_private.validate_snapshot(snapshot);
    select array_agg(a) into artists from jsonb_array_elements_text(snapshot->'artistNames') a;
  end if;

  if operation = 'create' then
    if jsonb_typeof(payload->'title') is distinct from 'string'
       or char_length(payload->>'title') not between 1 and 200 or btrim(payload->>'title') = '' then
      raise sqlstate 'PT400' using message = 'Invalid playlist title';
    end if;
    insert into public.playlists(owner_id, title) values(actor, btrim(payload->>'title')) returning * into collection;
    output := to_jsonb(collection);
  elsif operation = 'like' then
    if jsonb_typeof(payload->'liked') is distinct from 'boolean' then
      raise sqlstate 'PT400' using message = 'Invalid like state';
    end if;
    insert into public.track_likes(owner_id, track_id, liked, snapshot_title, snapshot_artist_names, snapshot_duration_ms)
      values(actor, payload->>'trackId', (payload->>'liked')::boolean, snapshot->>'title', artists, (snapshot->>'durationMs')::integer)
      on conflict (owner_id, track_id) do update set
        liked = excluded.liked, revision = public.track_likes.revision + 1,
        snapshot_title = excluded.snapshot_title, snapshot_artist_names = excluded.snapshot_artist_names,
        snapshot_duration_ms = excluded.snapshot_duration_ms returning * into liked_track;
    output := to_jsonb(liked_track);
  else
    target := (payload->>'playlistId')::uuid;
    select * into collection from public.playlists p
      where p.id = target and p.owner_id = actor and p.deleted_at is null for update;
    if not found then raise sqlstate 'PT404' using message = 'Playlist unavailable'; end if;
    if jsonb_typeof(payload->'expectedRevision') is distinct from 'number'
       or (payload->>'expectedRevision')::numeric <> collection.revision then
      raise sqlstate 'PT409' using message = 'Playlist revision changed';
    end if;
    if operation = 'rename' then
      if jsonb_typeof(payload->'title') is distinct from 'string'
         or char_length(payload->>'title') not between 1 and 200 or btrim(payload->>'title') = '' then
        raise sqlstate 'PT400' using message = 'Invalid playlist title';
      end if;
      update public.playlists set title = btrim(payload->>'title') where id = target;
    elsif operation = 'insert_item' then
      if payload ? 'orderingKey' then
        if jsonb_typeof(payload->'orderingKey') is distinct from 'number'
           or trunc((payload->>'orderingKey')::numeric) <> (payload->>'orderingKey')::numeric then
          raise sqlstate 'PT400' using message = 'Invalid ordering key';
        end if;
        position := (payload->>'orderingKey')::integer;
      else
        select coalesce(max(ordering_key), -1) + 1 into position from public.playlist_items where playlist_id = target;
      end if;
      insert into public.playlist_items(playlist_id, track_id, ordering_key, snapshot_title, snapshot_artist_names, snapshot_duration_ms)
        values(target, payload->>'trackId', position, snapshot->>'title', artists, (snapshot->>'durationMs')::integer)
        returning * into entry;
    elsif operation = 'remove_item' then
      delete from public.playlist_items where id = (payload->>'itemId')::uuid and playlist_id = target returning * into entry;
      if not found then raise sqlstate 'PT404' using message = 'Playlist item unavailable'; end if;
      insert into library_private.item_tombstones(item_id, owner_id, playlist_id, revision)
        values(entry.id, actor, target, collection.revision + 1);
    elsif operation = 'reorder' then
      if jsonb_typeof(payload->'itemIds') is distinct from 'array' then
        raise sqlstate 'PT400' using message = 'Expected item IDs';
      end if;
      select coalesce(array_agg(value::uuid), '{}'::uuid[]) into ordered_ids from jsonb_array_elements_text(payload->'itemIds');
      if cardinality(ordered_ids) <> (select count(*) from public.playlist_items where playlist_id = target)
         or cardinality(ordered_ids) <> (select count(distinct x) from unnest(ordered_ids) x)
         or exists(select 1 from unnest(ordered_ids) x where not exists(
           select 1 from public.playlist_items i where i.id = x and i.playlist_id = target)) then
        raise sqlstate 'PT400' using message = 'Reorder must contain each active item exactly once';
      end if;
      set constraints public.playlist_items_playlist_order_key deferred;
      update public.playlist_items i set ordering_key = ordering.ordinality::integer - 1
        from unnest(ordered_ids) with ordinality as ordering(id, ordinality)
        where i.id = ordering.id and i.playlist_id = target;
      set constraints public.playlist_items_playlist_order_key immediate;
    elsif operation = 'delete' then
      update public.playlists set deleted_at = now() where id = target;
    end if;
    update public.playlists set revision = revision + 1 where id = target returning * into collection;
    if operation = 'insert_item' then
      output := jsonb_build_object('playlist', to_jsonb(collection), 'item', to_jsonb(entry));
    else
      output := to_jsonb(collection);
    end if;
  end if;
  insert into library_private.mutation_receipts(owner_id, mutation_id, request, response)
    values(actor, mutation_id, requested, output);
  return output;
end;
$$;
revoke all on function library_private.mutate(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function library_private.mutate(text, uuid, jsonb) to authenticated;

-- The only exposed mutation entry point. No table DML grants accompany it.
create function public.library_mutate(operation text, mutation_id uuid, payload jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select library_private.mutate(operation, mutation_id, payload);
$$;
revoke all on function public.library_mutate(text, uuid, jsonb) from public, anon;
grant execute on function public.library_mutate(text, uuid, jsonb) to authenticated;

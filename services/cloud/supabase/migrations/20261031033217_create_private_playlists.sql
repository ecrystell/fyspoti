-- M0 only: private, owner-readable playlists and insert-only items.
-- No public access, editing, deletion, collaboration, or synchronization yet.
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200 and btrim(title) <> ''),
  visibility text not null default 'private' check (visibility = 'private'),
  created_at timestamptz not null default now()
);

create index playlists_owner_id_id_idx on public.playlists (owner_id, id);

create table public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  -- App-owned catalog IDs; P4 will supply canonical records. Never a provider URI.
  track_id uuid not null,
  ordering_key integer not null check (ordering_key >= 0),
  snapshot_title text not null check (char_length(snapshot_title) between 1 and 500 and btrim(snapshot_title) <> ''),
  snapshot_artist_names text[] not null check (
    cardinality(snapshot_artist_names) between 1 and 50
    and array_ndims(snapshot_artist_names) = 1
    and array_position(snapshot_artist_names, null) is null
    and array_position(snapshot_artist_names, '') is null
    and char_length(array_to_string(snapshot_artist_names, '')) <= 25000
  ),
  snapshot_duration_ms integer not null check (snapshot_duration_ms between 0 and 86400000),
  constraint playlist_items_playlist_order_key unique (playlist_id, ordering_key)
  -- Deliberately no unique(playlist_id, track_id): duplicate tracks are valid items.
);

alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;

-- Remove project default grants, including any auto-exposed UPDATE/DELETE permissions.
revoke all on public.playlists, public.playlist_items from anon, authenticated;
grant select, insert on public.playlists, public.playlist_items to authenticated;
-- Only the harness's server-side fixture cleanup uses service_role.
grant all on public.playlists, public.playlist_items to service_role;

create policy playlists_owner_select on public.playlists
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy playlists_owner_insert on public.playlists
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy playlist_items_owner_select on public.playlist_items
  for select to authenticated
  using (exists (
    select 1 from public.playlists p
    where p.id = playlist_items.playlist_id and p.owner_id = (select auth.uid())
  ));

create policy playlist_items_owner_insert on public.playlist_items
  for insert to authenticated
  with check (exists (
    select 1 from public.playlists p
    where p.id = playlist_items.playlist_id and p.owner_id = (select auth.uid())
  ));

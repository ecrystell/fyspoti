create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Listener' check (char_length(display_name) between 1 and 80 and btrim(display_name) <> ''),
  revision integer not null default 1 check (revision > 0)
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
create policy profiles_owner_select on public.profiles for select to authenticated using (id = (select auth.uid()));

create function library_private.profile_mutate(mutation_id uuid, expected_account uuid, expected_revision integer, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  requested jsonb := jsonb_build_object('operation', 'profile', 'accountId', expected_account, 'revision', expected_revision, 'displayName', display_name);
  receipt library_private.mutation_receipts%rowtype;
  profile public.profiles%rowtype;
  output jsonb;
begin
  if actor is null or actor is distinct from expected_account or not exists(select 1 from auth.users where id=actor) then
    raise sqlstate 'PT401' using message='Authentication required';
  end if;
  if mutation_id is null or expected_revision is null or expected_revision < 0
    or display_name is null or char_length(display_name) not between 1 and 80 or btrim(display_name)='' then
    raise sqlstate 'PT400' using message='Invalid profile edit';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select * into receipt from library_private.mutation_receipts r where r.owner_id=actor and r.mutation_id=profile_mutate.mutation_id;
  if found then
    if receipt.request <> requested then raise sqlstate 'PT409' using message='Mutation ID already used'; end if;
    return receipt.response;
  end if;
  -- Revision zero ensures a profile exists; it never overwrites an existing name.
  if expected_revision=0 then
    insert into public.profiles(id) values(actor) on conflict(id) do nothing;
  end if;
  select * into profile from public.profiles p where p.id=actor for update;
  if not found then raise sqlstate 'PT404' using message='Profile unavailable'; end if;
  if expected_revision > 0 then
    if profile.revision <> expected_revision then raise sqlstate 'PT409' using message='Profile changed'; end if;
    update public.profiles p set display_name=btrim(profile_mutate.display_name), revision=p.revision+1 where p.id=actor returning * into profile;
  end if;
  output := jsonb_build_object('id', profile.id, 'displayName', profile.display_name, 'revision', profile.revision);
  insert into library_private.mutation_receipts(owner_id,mutation_id,request,response) values(actor,mutation_id,requested,output);
  return output;
end;
$$;
revoke all on function library_private.profile_mutate(uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function library_private.profile_mutate(uuid,uuid,integer,text) to authenticated;
create function public.profile_mutate(mutation_id uuid, expected_account uuid, expected_revision integer, display_name text)
returns jsonb language sql security invoker set search_path = '' as $$
  select library_private.profile_mutate(mutation_id, expected_account, expected_revision, display_name);
$$;
revoke all on function public.profile_mutate(uuid,uuid,integer,text) from public, anon;
grant execute on function public.profile_mutate(uuid,uuid,integer,text) to authenticated;

-- Only one AgentForge provider instance may run the polling/write loop at a time.
-- Render deployments can briefly overlap instances; a process-local mutex is not
-- sufficient because both instances share the same provider wallet nonce.
create table if not exists public.agentforge_worker_leases (
  lease_key text primary key,
  owner_id text not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.agentforge_worker_leases enable row level security;
revoke all on table public.agentforge_worker_leases from anon, authenticated;
grant all on table public.agentforge_worker_leases to service_role;

create or replace function public.claim_agentforge_worker_lease(
  p_lease_key text,
  p_owner_id text,
  p_ttl_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  if p_ttl_seconds < 10 then
    raise exception 'lease ttl must be at least 10 seconds';
  end if;

  insert into public.agentforge_worker_leases (lease_key, owner_id, lease_until, updated_at)
  values (p_lease_key, p_owner_id, now() + make_interval(secs => p_ttl_seconds), now())
  on conflict (lease_key) do update
    set owner_id = excluded.owner_id,
        lease_until = excluded.lease_until,
        updated_at = excluded.updated_at
    where public.agentforge_worker_leases.lease_until <= now()
       or public.agentforge_worker_leases.owner_id = excluded.owner_id;

  select owner_id = p_owner_id and lease_until > now()
    into claimed
    from public.agentforge_worker_leases
   where lease_key = p_lease_key;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_agentforge_worker_lease(text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_agentforge_worker_lease(text, text, integer) to service_role;

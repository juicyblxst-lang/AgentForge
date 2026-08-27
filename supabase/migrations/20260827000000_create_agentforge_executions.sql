create table if not exists public.agentforge_executions (
  id text primary key,
  agent_id text not null,
  agent_name text not null,
  wallet text not null,
  chain_id integer not null check (chain_id = 97),
  protocol text not null check (protocol = 'ERC-8183'),
  job_id text not null,
  create_hash text not null,
  fund_hash text not null,
  status text not null check (status in ('CREATED','REGISTERED','FUNDED','SUBMITTED','SETTLED','VERIFIED','FAILED')),
  submitted_at timestamptz,
  settled_at timestamptz,
  deliverable text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe upgrades for databases where the table was created by an earlier migration.
alter table public.agentforge_executions add column if not exists submitted_at timestamptz;
alter table public.agentforge_executions add column if not exists settled_at timestamptz;
alter table public.agentforge_executions add column if not exists deliverable text;

create index if not exists agentforge_executions_wallet_created_idx
  on public.agentforge_executions (lower(wallet), created_at desc);

alter table public.agentforge_executions enable row level security;
revoke all on public.agentforge_executions from anon, authenticated;
grant select, insert, update on public.agentforge_executions to service_role;

alter table public.agentforge_executions drop constraint if exists agentforge_executions_status_check;
alter table public.agentforge_executions add constraint agentforge_executions_status_check check (status in ('CREATED','REGISTERED','FUNDED','SUBMITTED','SETTLED','VERIFIED','FAILED'));

alter table public.agentforge_executions add column if not exists submitted_at timestamptz;
alter table public.agentforge_executions add column if not exists settled_at timestamptz;
alter table public.agentforge_executions add column if not exists deliverable text;

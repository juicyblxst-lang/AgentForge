-- One AgentForge execution record per ERC-8183 job.
-- Job ID is the durable correlation key across the on-chain lifecycle.
create unique index if not exists agentforge_executions_job_id_uidx
  on public.agentforge_executions (job_id);

-- The provider learns the authoritative client/job identity from chain, but
-- does not possess the user's create/fund transaction hashes. Those hashes are
-- therefore optional lifecycle metadata rather than required persistence keys.
alter table public.agentforge_executions alter column create_hash drop not null;
alter table public.agentforge_executions alter column fund_hash drop not null;

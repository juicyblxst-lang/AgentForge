-- One AgentForge execution record per ERC-8183 job.
-- Job ID is the durable correlation key across the on-chain lifecycle.
create unique index if not exists agentforge_executions_job_id_uidx
  on public.agentforge_executions (job_id);

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const STATUS_RANK = { CREATED: 0, REGISTERED: 1, FUNDED: 2, SUBMITTED: 3, SETTLED: 4, VERIFIED: 5, FAILED: 99 };

function assertConfigured() {
  if (!supabase) throw new Error("Supabase persistence is not configured for the provider worker");
}
function address(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) throw new Error(`Invalid wallet address: ${value}`);
  return normalized;
}
function statusRank(status) { return STATUS_RANK[String(status || "").toUpperCase()] ?? -1; }

export async function persistExecution({ job, agentId, agentName, status, deliverable = null, submittedAt = null, settledAt = null, createHash = null, fundHash = null }) {
  assertConfigured();
  const jobId = String(job.id);
  const wallet = address(job.client);
  const normalizedStatus = String(status || "").toUpperCase();
  if (!Object.hasOwn(STATUS_RANK, normalizedStatus)) throw new Error(`Invalid execution status: ${status}`);
  if (!agentId || !agentName) throw new Error("ERC-8004 agent identity is required for execution persistence");

  const { data: existing, error: existingError } = await supabase.from("agentforge_executions").select("*").eq("job_id", jobId).maybeSingle();
  if (existingError) throw new Error(`Execution lookup failed for job #${jobId}: ${existingError.message}`);
  const existingRank = existing ? statusRank(existing.status) : -1;
  if (existing && existingRank > statusRank(normalizedStatus)) return existing;

  const now = new Date().toISOString();
  const row = {
    id: existing?.id || jobId,
    agent_id: existing?.agent_id || String(agentId),
    agent_name: existing?.agent_name || String(agentName),
    wallet: existing?.wallet || wallet,
    chain_id: 97,
    protocol: "ERC-8183",
    job_id: jobId,
    create_hash: createHash || existing?.create_hash || null,
    fund_hash: fundHash || existing?.fund_hash || null,
    status: normalizedStatus,
    submitted_at: submittedAt || existing?.submitted_at || (normalizedStatus === "SUBMITTED" ? now : null),
    settled_at: settledAt || existing?.settled_at || (["SETTLED", "VERIFIED"].includes(normalizedStatus) ? now : null),
    deliverable: deliverable || existing?.deliverable || null,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  const { data, error } = await supabase.from("agentforge_executions").upsert(row, { onConflict: "job_id" }).select().single();
  if (error) throw new Error(`Execution persistence failed for job #${jobId}: ${error.message}`);
  return data;
}

export async function getPersistedExecution(jobId) {
  assertConfigured();
  const { data, error } = await supabase.from("agentforge_executions").select("*").eq("job_id", String(jobId)).maybeSingle();
  if (error) throw new Error(`Execution lookup failed for job #${jobId}: ${error.message}`);
  return data;
}

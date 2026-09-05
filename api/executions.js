import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const STATUSES = new Set(['CREATED', 'REGISTERED', 'FUNDED', 'SUBMITTED', 'SETTLED', 'VERIFIED', 'FAILED']);

function send(res, status, body) {
  res.status(status).json(body);
}

function mapExecution(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    wallet: row.wallet,
    chainId: row.chain_id,
    protocol: row.protocol,
    jobId: row.job_id,
    createHash: row.create_hash,
    fundHash: row.fund_hash,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    settledAt: row.settled_at,
    deliverable: row.deliverable,
  };
}

export default async function handler(req, res) {
  if (!supabase) return send(res, 503, { error: 'Supabase persistence is not configured on the server' });

  try {
    if (req.method === 'GET') {
      const wallet = String(req.query?.wallet || '').trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(wallet)) return send(res, 400, { error: 'A valid wallet address is required' });

      const { data, error } = await supabase
        .from('agentforge_executions')
        .select('*')
        .eq('wallet', wallet)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) return send(res, 502, { error: error.message });
      return send(res, 200, { executions: (data || []).map(mapExecution) });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const wallet = String(body.wallet || '').trim().toLowerCase();
      const status = String(body.status || '');
      const jobId = String(body.jobId || '').trim();
      if (!/^0x[a-f0-9]{40}$/.test(wallet)) return send(res, 400, { error: 'Invalid wallet address' });
      if (!STATUSES.has(status)) return send(res, 400, { error: `Invalid execution status: ${status}` });
      if (!jobId) return send(res, 400, { error: 'jobId is required' });

      const row = {
        id: String(body.id || jobId),
        agent_id: String(body.agentId || ''),
        agent_name: String(body.agentName || ''),
        wallet,
        chain_id: 97,
        protocol: 'ERC-8183',
        job_id: jobId,
        create_hash: body.createHash ? String(body.createHash) : null,
        fund_hash: body.fundHash ? String(body.fundHash) : null,
        status,
        submitted_at: body.submittedAt ? String(body.submittedAt) : null,
        settled_at: body.settledAt ? String(body.settledAt) : null,
        deliverable: body.deliverable ? String(body.deliverable) : null,
        created_at: String(body.createdAt || new Date().toISOString()),
        updated_at: new Date().toISOString(),
      };

      if (!row.agent_id || !row.agent_name) {
        return send(res, 400, { error: 'agentId and agentName are required' });
      }

      // Job ID is the canonical correlation key. Lifecycle writes may arrive
      // from different components, so absent fields must not erase values that
      // were already recorded for this job.
      const { data: existing, error: existingError } = await supabase
        .from('agentforge_executions')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle();
      if (existingError) return send(res, 502, { error: existingError.message });

      if (existing) {
        row.id = existing.id;
        row.create_hash = row.create_hash || existing.create_hash;
        row.fund_hash = row.fund_hash || existing.fund_hash;
        row.created_at = existing.created_at;
        row.agent_id = existing.agent_id || row.agent_id;
        row.agent_name = existing.agent_name || row.agent_name;
        row.wallet = existing.wallet || row.wallet;
      }

      const { data, error } = await supabase
        .upsert(row, { onConflict: 'job_id' })
        .select()
        .single();

      if (error) return send(res, 502, { error: error.message });
      return send(res, 200, { execution: mapExecution(data) });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return send(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
  }
}

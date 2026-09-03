import { resolveAgentServiceForWallet } from '../scripts/erc8004-agent.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const providerAddress = String(process.env.AGENTFORGE_PROVIDER_ADDRESS || '').trim();
  const body = req.body || {};
  const jobId = Number(body.jobId);
  const agentId = body.agentId == null ? null : Number(body.agentId);

  if (!/^0x[a-fA-F0-9]{40}$/.test(providerAddress)) {
    return res.status(503).json({ error: 'AgentForge execution provider is not configured' });
  }
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return res.status(400).json({ error: 'jobId must be a positive integer' });
  }
  if (agentId != null && (!Number.isInteger(agentId) || agentId <= 0)) {
    return res.status(400).json({ error: 'agentId must be a positive integer' });
  }

  try {
    // Resolve the AgentForge provider endpoint from its own ERC-8004 registration.
    // The provider address is the only configured identity; its executable service
    // remains dynamically resolved from the registry metadata.
    const service = await resolveAgentServiceForWallet(providerAddress, 97);
    const response = await fetch(service.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jobId, ...(agentId == null ? {} : { agentId }) }),
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
    if (!response.ok) return res.status(response.status).json({ error: payload?.error || raw || `Provider returned ${response.status}`, service });
    return res.status(200).json({ provider: providerAddress, service, ...payload });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Provider execution failed' });
  }
}

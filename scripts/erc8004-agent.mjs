const SCAN_BASE = 'https://api.8004scan.io/api/v1';

function decodeDataUri(uri) {
  if (!uri?.startsWith('data:application/json;base64,')) return null;
  try {
    return JSON.parse(Buffer.from(uri.slice('data:application/json;base64,'.length), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw new Error(`8004Scan request failed (${response.status}): ${text.slice(0, 300)}`);
  return body;
}

function registrationFromScan(body) {
  return body?.agent?.registrationFile || body?.registrationFile || body?.data?.registrationFile || null;
}

function agentUriFromScan(body) {
  return body?.agent?.agentURI || body?.agentURI || body?.data?.agentURI || null;
}

function servicesFromRegistration(registration) {
  const services = Array.isArray(registration?.services)
    ? registration.services
    : Array.isArray(registration?.endpoints)
      ? registration.endpoints
      : [];
  return services.filter(service => typeof service?.endpoint === 'string' && service.endpoint.trim());
}

async function resolveRegistration(agentId, chainId) {
  const headers = {};
  if (process.env.AGENT8004SCAN_API_KEY) headers['X-API-Key'] = process.env.AGENT8004SCAN_API_KEY;
  const body = await fetchJson(`${SCAN_BASE}/agents/${encodeURIComponent(chainId)}/${encodeURIComponent(agentId)}`, { headers });
  let registration = registrationFromScan(body);
  const agentURI = agentUriFromScan(body);

  if (!registration && agentURI) {
    registration = decodeDataUri(agentURI);
    if (!registration) {
      const uri = agentURI.startsWith('ipfs://')
        ? `https://ipfs.io/ipfs/${agentURI.slice('ipfs://'.length)}`
        : agentURI;
      registration = await fetchJson(uri);
    }
  }

  if (!registration) throw new Error(`ERC-8004 agent ${agentId} has no resolvable registration file`);
  return { registration, agentURI, scan: body };
}

function agentIdFromRecord(record) {
  const value = record?.agentId ?? record?.agent?.agentId ?? record?.tokenId ?? record?.agent?.tokenId;
  return value == null ? null : String(value);
}

function walletFromRecord(record) {
  return record?.agentWallet
    ?? record?.agent?.agentWallet
    ?? record?.wallet
    ?? record?.agent?.wallet
    ?? null;
}

function normalizeAddress(value) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : null;
}

async function resolveAgentIdByWallet(agentWallet, chainId) {
  const normalizedWallet = normalizeAddress(agentWallet);
  if (!normalizedWallet) throw new Error(`Invalid selected agent wallet: ${agentWallet}`);

  const headers = {};
  if (process.env.AGENT8004SCAN_API_KEY) headers['X-API-Key'] = process.env.AGENT8004SCAN_API_KEY;
  const body = await fetchJson(
    `${SCAN_BASE}/agents?chainId=${encodeURIComponent(chainId)}&owner_address=${encodeURIComponent(agentWallet)}&page=1&pageSize=100`,
    { headers },
  );

  const records = Array.isArray(body) ? body : (body?.agents || body?.data?.agents || body?.data || []);
  if (!Array.isArray(records)) throw new Error(`8004Scan returned an unexpected agent-list response for wallet ${agentWallet}`);

  const match = records.find(record => normalizeAddress(walletFromRecord(record)) === normalizedWallet);
  const agentId = agentIdFromRecord(match);
  if (!agentId) {
    throw new Error(`No ERC-8004 agent found on chain ${chainId} for selected agent wallet ${agentWallet}`);
  }
  return agentId;
}

export async function resolveAgentService(agentId, chainId = 97) {
  const { registration, agentURI, scan } = await resolveRegistration(agentId, chainId);
  const services = servicesFromRegistration(registration);

  const preferred = services.find(service => /^a2a$/i.test(service.name || ''))
    || services.find(service => /a2a|agent.?card/i.test(service.name || ''))
    || services.find(service => /erc.?8183/i.test(service.name || ''))
    || services.find(service => /^mcp$/i.test(service.name || ''))
    || services.find(service => /^https?:\/\//i.test(service.endpoint));

  if (!preferred) throw new Error(`ERC-8004 agent ${agentId} has no executable HTTP service endpoint`);

  return {
    agentId: String(agentId),
    chainId: Number(chainId),
    agentURI,
    name: registration.name,
    serviceName: preferred.name || 'custom',
    endpoint: preferred.endpoint,
    version: preferred.version,
    protocol: /^a2a$/i.test(preferred.name || '') || /a2a|agent.?card/i.test(preferred.name || '') ? 'a2a' : 'custom',
    registration,
    scan,
  };
}

export async function resolveAgentServiceForWallet(agentWallet, chainId = 97) {
  const agentId = await resolveAgentIdByWallet(agentWallet, chainId);
  return resolveAgentService(agentId, chainId);
}

// Backward-compatible parser for jobs created by older AgentForge builds.
// New routing should always resolve from the on-chain job.provider wallet.
export function extractAgentRoute(description) {
  const match = String(description || '').match(/ERC-8004 agent\s+(\d+)/i);
  if (!match) return null;
  return { agentId: match[1], chainId: 97 };
}

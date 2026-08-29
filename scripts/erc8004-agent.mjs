const SCAN_BASE = 'https://api.8004scan.io/api/v1';

function decodeDataUri(uri) {
  if (!uri?.startsWith('data:application/json;base64,')) return null;
  try { return JSON.parse(Buffer.from(uri.slice('data:application/json;base64,'.length), 'base64').toString('utf8')); } catch { return null; }
}

async function fetchJson(url, init = {}) {
  console.log(`[erc8004-debug] FETCH url=${url}`);
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init.headers || {}) } });
  const text = await response.text(); let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  console.log(`[erc8004-debug] FETCH_RESULT url=${url} status=${response.status} ok=${response.ok} body=${JSON.stringify(body ?? text).slice(0, 20000)}`);
  if (!response.ok) throw new Error(`8004Scan request failed (${response.status}): ${text.slice(0, 300)}`);
  return body;
}

function registrationFromScan(body) { return body?.agent?.registrationFile || body?.registrationFile || body?.data?.registrationFile || null; }
function agentUriFromScan(body) { return body?.agent?.agentURI || body?.agentURI || body?.data?.agentURI || null; }
function servicesFromRegistration(registration) { const services = Array.isArray(registration?.services) ? registration.services : Array.isArray(registration?.endpoints) ? registration.endpoints : []; return services.filter(service => typeof service?.endpoint === 'string' && service.endpoint.trim()); }

async function resolveRegistration(agentId, chainId) {
  console.log(`[erc8004-debug] resolveRegistration START agentId=${agentId} chainId=${chainId}`);
  const headers = {}; if (process.env.AGENT8004SCAN_API_KEY) headers['X-API-Key'] = process.env.AGENT8004SCAN_API_KEY;
  const scanUrl = `${SCAN_BASE}/agents/${encodeURIComponent(chainId)}/${encodeURIComponent(agentId)}`;
  const body = await fetchJson(scanUrl, { headers });
  console.log(`[erc8004-debug] SCAN_RESPONSE agentId=${agentId} chainId=${chainId} fullResponse=${JSON.stringify(body).slice(0, 30000)}`);
  let registration = registrationFromScan(body); const agentURI = agentUriFromScan(body);
  console.log(`[erc8004-debug] EXTRACTED agentId=${agentId} agentURI=${agentURI ?? 'null'} registration=${JSON.stringify(registration).slice(0, 30000)}`);
  if (!registration && agentURI) {
    registration = decodeDataUri(agentURI);
    console.log(`[erc8004-debug] DATA_URI_DECODE agentId=${agentId} decoded=${JSON.stringify(registration).slice(0, 30000)}`);
    if (!registration) {
      const uri = agentURI.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${agentURI.slice('ipfs://'.length)}` : agentURI;
      console.log(`[erc8004-debug] REGISTRATION_FETCH_PREP agentId=${agentId} agentURI=${agentURI} finalFetchUrl=${uri}`);
      try { registration = await fetchJson(uri); }
      catch (error) {
        console.error(`[erc8004-debug] REGISTRATION_FETCH_FAILED agentId=${agentId} agentURI=${agentURI} finalFetchUrl=${uri} error=${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      console.log(`[erc8004-debug] REGISTRATION_FETCH_RESULT agentId=${agentId} finalFetchUrl=${uri} registration=${JSON.stringify(registration).slice(0, 30000)}`);
    }
  }
  if (!registration) {
    console.error(`[erc8004-debug] UNRESOLVABLE_REGISTRATION agentId=${agentId} chainId=${chainId} fullScanResponse=${JSON.stringify(body).slice(0, 30000)} agentURI=${agentURI ?? 'null'} registration=${JSON.stringify(registration)}`);
    throw new Error(`ERC-8004 agent ${agentId} has no resolvable registration file`);
  }
  console.log(`[erc8004-debug] resolveRegistration SUCCESS agentId=${agentId} chainId=${chainId} agentURI=${agentURI ?? 'null'} registration=${JSON.stringify(registration).slice(0, 30000)}`);
  return { registration, agentURI, scan: body };
}

export async function resolveAgentService(agentId, chainId = 97) {
  const { registration, agentURI, scan } = await resolveRegistration(agentId, chainId);
  const services = servicesFromRegistration(registration);
  const preferred = services.find(service => /^a2a$/i.test(service.name || '')) || services.find(service => /a2a|agent.?card/i.test(service.name || '')) || services.find(service => /erc.?8183/i.test(service.name || '')) || services.find(service => /^mcp$/i.test(service.name || '')) || services.find(service => /^https?:\/\//i.test(service.endpoint));
  if (!preferred) throw new Error(`ERC-8004 agent ${agentId} has no executable HTTP service endpoint`);
  return { agentId: String(agentId), chainId: Number(chainId), agentURI, name: registration.name, serviceName: preferred.name || 'custom', endpoint: preferred.endpoint, version: preferred.version, protocol: /^a2a$/i.test(preferred.name || '') || /a2a|agent.?card/i.test(preferred.name || '') ? 'a2a' : 'custom', registration, scan };
}

export function extractAgentRoute(description) { const match = String(description || '').match(/ERC-8004 agent\s+(\d+)/i); return match ? { agentId: match[1], chainId: 97 } : null; }

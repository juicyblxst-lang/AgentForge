const SCAN_BASE = 'https://api.8004scan.io/api/v1';

function debug(label, payload) { console.log(`[erc8004-debug] ${label} ${JSON.stringify(payload).slice(0, 50000)}`); }
function parseJsonText(text) { if (typeof text !== 'string' || !text.trim()) return null; try { return JSON.parse(text); } catch { return null; } }
function decodeDataUri(uri) { if (typeof uri !== 'string' || !uri.toLowerCase().startsWith('data:')) return null; try { const comma = uri.indexOf(','); if (comma < 0) return null; const metadata = uri.slice(5, comma); const payload = uri.slice(comma + 1); const isBase64 = /;base64(?:;|$)/i.test(metadata); const text = isBase64 ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload); const decoded = parseJsonText(text); debug('DATA_URI_DECODE', { decoded, mime: metadata.split(';')[0] || 'text/plain' }); return decoded; } catch (error) { debug('DATA_URI_DECODE_FAILED', { error: String(error) }); return null; } }
async function fetchJson(url, init = {}) { debug('FETCH_START', { url, method: init.method || 'GET' }); let response; try { response = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init.headers || {}) } }); } catch (error) { debug('FETCH_NETWORK_ERROR', { url, error: String(error) }); throw error; } const text = await response.text(); const body = parseJsonText(text); debug('FETCH_RESULT', { url, status: response.status, ok: response.ok, body: body ?? text }); if (!response.ok) throw new Error(`Registration request failed (${response.status}): ${text.slice(0, 500)}`); return body; }
function registrationFromScan(body) { return body?.agent?.registrationFile || body?.registrationFile || body?.data?.registrationFile || null; }
function agentUriFromScan(body) { return body?.agent?.agentURI || body?.agentURI || body?.data?.agentURI || null; }
function rawMetadataFromScan(body) { return body?.raw_metadata || body?.rawMetadata || body?.agent?.raw_metadata || body?.agent?.rawMetadata || body?.data?.raw_metadata || body?.data?.rawMetadata || null; }
function normalizeRawMetadata(rawMetadata) {
  if (!rawMetadata) return null;
  let parsed = rawMetadata;
  if (typeof parsed === 'string') parsed = parseJsonText(parsed) || decodeDataUri(parsed);
  if (!parsed || typeof parsed !== 'object') return null;
  const registration = parsed.offchain_content || parsed.offchainContent || parsed.registrationFile || parsed.registration || parsed;
  if (typeof registration === 'string') return parseJsonText(registration) || decodeDataUri(registration) || null;
  return registration && typeof registration === 'object' ? registration : null;
}
function servicesFromRegistration(registration) { const services = Array.isArray(registration?.services) ? registration.services : Array.isArray(registration?.endpoints) ? registration.endpoints : []; return services.filter(service => typeof service?.endpoint === 'string' && service.endpoint.trim()); }
async function resolveRegistration(agentId, chainId) { debug('RESOLVE_START', { agentId: String(agentId), chainId: Number(chainId) }); const headers = {}; if (process.env.AGENT8004SCAN_API_KEY) headers['X-API-Key'] = process.env.AGENT8004SCAN_API_KEY; const scanUrl = `${SCAN_BASE}/agents/${encodeURIComponent(chainId)}/${encodeURIComponent(agentId)}`; const body = await fetchJson(scanUrl, { headers }); debug('SCAN_RESPONSE_FULL', { agentId: String(agentId), chainId: Number(chainId), scanUrl, response: body }); let registration = registrationFromScan(body); const agentURI = agentUriFromScan(body); const rawMetadata = rawMetadataFromScan(body); debug('EXTRACTED_REGISTRATION_FIELDS', { agentId: String(agentId), chainId: Number(chainId), registrationFile: registration, agentURI, rawMetadata }); if (!registration && rawMetadata) { registration = normalizeRawMetadata(rawMetadata); debug('RAW_METADATA_FALLBACK', { agentId: String(agentId), source: '8004Scan.raw_metadata', resolved: registration }); } if (!registration && agentURI) { debug('REGISTRATION_RESOLUTION_DECISION', { decision: 'registrationFile_missing_use_agentURI', agentURI }); registration = decodeDataUri(agentURI); if (!registration) { const uri = agentURI.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${agentURI.slice('ipfs://'.length)}` : agentURI; debug('REGISTRATION_FETCH_URL', { agentId: String(agentId), agentURI, finalFetchUrl: uri }); registration = await fetchJson(uri); debug('REGISTRATION_FETCH_PARSED', { agentId: String(agentId), finalFetchUrl: uri, registration }); } } else if (!registration) { debug('REGISTRATION_RESOLUTION_DECISION', { decision: 'FAIL_NO_REGISTRATION_AGENT_URI_OR_RAW_METADATA', agentId: String(agentId), chainId: Number(chainId), registrationFile: registrationFromScan(body), agentURI: agentURI ?? null, rawMetadata: rawMetadata ?? null }); } if (!registration) { debug('UNRESOLVABLE_REGISTRATION', { agentId: String(agentId), chainId: Number(chainId), scanResponse: body, registrationFile: registrationFromScan(body), agentURI, rawMetadata, decision: 'throw_no_resolvable_registration_file' }); throw new Error(`ERC-8004 agent ${agentId} has no resolvable registration file`); } debug('REGISTRATION_SUCCESS', { agentId: String(agentId), chainId: Number(chainId), agentURI, source: registrationFromScan(body) ? 'registrationFile' : rawMetadata ? 'raw_metadata' : 'agentURI', registration }); return { registration, agentURI, scan: body }; }
function agentIdFromRecord(record) { const value = record?.agentId ?? record?.agent?.agentId ?? record?.tokenId ?? record?.agent?.tokenId; return value == null ? null : String(value); }
function walletFromRecord(record) { return record?.agentWallet ?? record?.agent?.agentWallet ?? record?.wallet ?? record?.agent?.wallet ?? null; }
function normalizeAddress(value) { return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : null; }
async function resolveAgentIdByWallet(agentWallet, chainId) { const normalizedWallet = normalizeAddress(agentWallet); if (!normalizedWallet) throw new Error(`Invalid selected agent wallet: ${agentWallet}`); const headers = {}; if (process.env.AGENT8004SCAN_API_KEY) headers['X-API-Key'] = process.env.AGENT8004SCAN_API_KEY; const listUrl = `${SCAN_BASE}/agents?chainId=${encodeURIComponent(chainId)}&owner_address=${encodeURIComponent(agentWallet)}&page=1&pageSize=100`; const body = await fetchJson(listUrl, { headers }); debug('WALLET_AGENT_LIST_RESPONSE', { agentWallet, chainId: Number(chainId), listUrl, response: body }); const records = Array.isArray(body) ? body : (body?.agents || body?.data?.agents || body?.data || []); if (!Array.isArray(records)) throw new Error(`8004Scan returned an unexpected agent-list response for wallet ${agentWallet}`); const match = records.find(record => normalizeAddress(walletFromRecord(record)) === normalizedWallet); const agentId = agentIdFromRecord(match); debug('WALLET_AGENT_RESOLUTION', { agentWallet, chainId: Number(chainId), matchedRecord: match, agentId }); if (!agentId) throw new Error(`No ERC-8004 agent found on chain ${chainId} for selected agent wallet ${agentWallet}`); return agentId; }
function isA2AService(service) { return /^a2a$/i.test(service?.name || '') || /a2a|agent.?card/i.test(service?.name || ''); }
function normalizeA2AExecutionUrl(value, cardUrl) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  try {
    const candidate = new URL(value);
    const card = new URL(cardUrl);
    // AgentCards sometimes advertise their base URL as plain HTTP even when
    // the card itself is served over HTTPS. For a remote HTTPS-hosted card,
    // upgrade only the same-host HTTP URL; never invent a different host.
    if (candidate.protocol === 'http:' && card.protocol === 'https:' && candidate.hostname === card.hostname) {
      candidate.protocol = 'https:';
    }
    return candidate.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}
async function resolveA2AExecutionEndpoint(service, agentId) {
  if (!isA2AService(service)) return service.endpoint;
  const card = await fetchJson(service.endpoint);
  const candidates = [
    card?.url,
    card?.endpoint,
    card?.serviceEndpoint,
    ...(Array.isArray(card?.supportedInterfaces) ? card.supportedInterfaces.map(item => item?.url || item?.endpoint) : []),
    ...(Array.isArray(card?.endpoints) ? card.endpoints.map(item => typeof item === 'string' ? item : item?.url || item?.endpoint) : []),
  ].map(value => normalizeA2AExecutionUrl(value, service.endpoint)).filter(Boolean);
  const executionEndpoint = candidates[0] || null;
  debug('A2A_AGENT_CARD_RESOLUTION', { agentId: String(agentId), cardUrl: service.endpoint, executionEndpoint, candidates, card });
  if (!executionEndpoint) throw new Error(`A2A agent ${agentId} returned an AgentCard without an executable endpoint`);
  return executionEndpoint;
}
export async function resolveAgentService(agentId, chainId = 97) { const { registration, agentURI, scan } = await resolveRegistration(agentId, chainId); const services = servicesFromRegistration(registration); debug('SERVICE_EXTRACTION', { agentId: String(agentId), services, registration }); const preferred = services.find(service => isA2AService(service)) || services.find(service => /erc.?8183/i.test(service.name || '')) || services.find(service => /^mcp$/i.test(service.name || '')) || services.find(service => /^https?:\/\//i.test(service.endpoint)); debug('SERVICE_SELECTION', { agentId: String(agentId), selected: preferred || null }); if (!preferred) throw new Error(`ERC-8004 agent ${agentId} has no executable HTTP service endpoint`); const endpoint = await resolveA2AExecutionEndpoint(preferred, agentId); return { agentId: String(agentId), chainId: Number(chainId), agentURI, name: registration.name, serviceName: preferred.name || 'custom', endpoint, registrationEndpoint: preferred.endpoint, version: preferred.version, protocol: isA2AService(preferred) ? 'a2a' : 'custom', registration, scan }; }
export async function resolveAgentServiceForWallet(agentWallet, chainId = 97) { const agentId = await resolveAgentIdByWallet(agentWallet, chainId); return resolveAgentService(agentId, chainId); }
export function extractAgentRoute(description) { const match = String(description || '').match(/ERC-8004 agent\s+(\d+)/i); if (!match) return null; return { agentId: match[1], chainId: 97 }; }

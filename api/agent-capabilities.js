const cache = new Map();
const TTL_MS = 6 * 60 * 60 * 1000;

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    return true;
  } catch { return false; }
}

function normalizeUri(uri) {
  if (typeof uri !== 'string') return '';
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return uri;
}

async function fetchJson(url) {
  if (!isPublicHttpUrl(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

function strings(value) {
  return Array.isArray(value)
    ? value.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())
    : [];
}

function capabilityValues(value) {
  return strings(value).filter(x => !/^https?:\/\//i.test(x) && !/^a2a:\s*https?:\/\//i.test(x));
}

function endpointValues(value) {
  return strings(value).filter(isPublicHttpUrl);
}

function extractRegistrationCapabilities(registration) {
  const capabilities = [];
  const endpoints = [];
  const addCaps = value => capabilities.push(...capabilityValues(value));
  const addEndpoints = value => endpoints.push(...endpointValues(value));

  for (const key of ['capabilities', 'skills', 'tools', 'a2aSkills', 'mcpTools']) addCaps(registration?.[key]);
  addEndpoints(registration?.a2aEndpoint);
  addEndpoints(registration?.mcpEndpoint);

  for (const service of Array.isArray(registration?.services) ? registration.services : []) {
    for (const key of ['skills', 'tools', 'capabilities', 'a2aSkills', 'mcpTools']) addCaps(service?.[key]);
    for (const key of ['endpoint', 'a2aEndpoint', 'mcpEndpoint', 'url']) addEndpoints(service?.[key]);
  }

  return { capabilities, endpoints: [...new Set(endpoints)] };
}

async function fetchA2ACard(endpoint) {
  if (!isPublicHttpUrl(endpoint)) return null;
  const base = endpoint.replace(/\/+$/, '');
  const candidates = endpoint.includes('/.well-known/')
    ? [endpoint, `${base}/.well-known/agent-card.json`, `${base}/.well-known/agent.json`]
    : [`${base}/.well-known/agent-card.json`, `${base}/.well-known/agent.json`];

  for (const cardUrl of [...new Set(candidates)]) {
    const card = await fetchJson(cardUrl);
    if (!card || !Array.isArray(card.skills)) continue;
    const capabilities = [];
    for (const skill of card.skills) {
      if (typeof skill === 'string') capabilities.push(skill.trim());
      else if (skill && typeof skill === 'object') {
        if (typeof skill.name === 'string' && skill.name.trim()) capabilities.push(skill.name.trim());
        else if (typeof skill.id === 'string' && skill.id.trim()) capabilities.push(skill.id.trim());
        capabilities.push(...capabilityValues(skill.tags));
      }
    }
    return { agentCardUrl: cardUrl, capabilities: [...new Set(capabilities)] };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const agentURI = normalizeUri(url.searchParams.get('agentURI') || '');
  const agentId = url.searchParams.get('agentId');
  const chainId = Number(url.searchParams.get('chainId') || 97);
  if (!agentURI || !agentId) return res.status(400).json({ error: 'agentURI and agentId are required' });

  const cacheKey = `${agentURI}|${agentId}|${chainId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return res.status(200).json(cached.data);

  let registration;
  if (agentURI.startsWith('data:application/json;base64,')) {
    try { registration = JSON.parse(Buffer.from(agentURI.slice('data:application/json;base64,'.length), 'base64').toString('utf8')); } catch {}
  } else if (agentURI.startsWith('data:application/json,')) {
    try { registration = JSON.parse(decodeURIComponent(agentURI.slice('data:application/json,'.length))); } catch {}
  } else {
    registration = await fetchJson(agentURI);
  }

  if (!registration || typeof registration !== 'object') {
    const payload = { verified: false, registrationBound: false, capabilities: [], agentCardUrl: null, reason: 'ERC-8004 registration metadata could not be loaded.' };
    cache.set(cacheKey, { data: payload, expires: Date.now() + TTL_MS });
    return res.status(200).json(payload);
  }

  const expected = `eip155:${chainId}:`;
  const registrations = Array.isArray(registration.registrations) ? registration.registrations : [];
  const registrationBound = registrations.some(entry => Number(entry?.agentId) === Number(agentId) && String(entry?.agentRegistry || '').toLowerCase().startsWith(expected));
  const active = registration.active !== false;
  const extracted = extractRegistrationCapabilities(registration);
  const cardResults = await Promise.all(extracted.endpoints.map(fetchA2ACard));
  const cards = cardResults.filter(Boolean);
  const capabilities = [...new Set([...extracted.capabilities, ...cards.flatMap(x => x.capabilities)])];
  const payload = {
    verified: registrationBound && active && capabilities.length > 0,
    registrationBound,
    active,
    capabilities,
    agentCardUrl: cards[0]?.agentCardUrl || null,
    source: cards.length ? 'a2a_agent_card' : extracted.capabilities.length ? 'registration_file' : 'none',
    reason: !registrationBound ? 'Registration file is not cryptographically bound to this ERC-8004 agent.' : !active ? 'Agent registration is marked inactive.' : capabilities.length ? undefined : 'No declared capabilities were found in the registration file or its public A2A Agent Card.'
  };
  cache.set(cacheKey, { data: payload, expires: Date.now() + TTL_MS });
  return res.status(200).json(payload);
}

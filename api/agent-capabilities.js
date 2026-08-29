const cache = new Map();
const TTL_MS = 6 * 60 * 60 * 1000;

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '::1'].includes(host)) return false;
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
  return Array.isArray(value) ? value.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
}

function capabilityValues(value) {
  return strings(value).filter(x => !/^https?:\/\//i.test(x) && !/^a2a:\s*https?:\/\//i.test(x) && !/^mcp:\s*https?:\/\//i.test(x));
}

function endpointValues(value) { return strings(value).filter(isPublicHttpUrl); }

function serviceKind(service) {
  return String(service?.name ?? service?.type ?? service?.protocol ?? service?.kind ?? '').trim().toLowerCase();
}

function descriptionCapabilities(registration) {
  const text = String(registration?.description ?? '').toLowerCase();
  const name = String(registration?.name ?? '').toLowerCase();
  const haystack = `${name} ${text}`;
  const rules = [
    [/rebalanc|range rebalanc|range keeper|liquidity range|concentrated liquidity|position management/, 'Rebalancing'],
    [/grid trading|grid trader|grid bot|grid strateg|grid order|grid levels|grid spacing/, 'Grid Trading'],
    [/yield optim|yield router|highest yield|best yield|yield venue|apy|apr|liquidity mining|staking/, 'Yield Optimisation'],
    [/health factor|liquidation|liquidation risk|safe borrow|borrow health|lending position|collateral health|venus lending/, 'Health Factor Monitoring'],
    [/pancakeswap v3 pool|pancakeswap v3|pancakeswap liquidity/, 'PancakeSwap V3'],
    [/pool and position|reads a .*pool|pool volatility|market volatility/, 'Pool and market analysis'],
    [/proposes? .*range|replacement range|range width/, 'Range proposal'],
    [/executes? .*rebalance|execute.*rebalance/, 'Rebalance execution'],
    [/altana session|session.*spend cap|spend cap|protocol allowlist|expiry/, 'Bounded session execution'],
    [/automated swap|swap execution|trading/, 'Trade execution'],
    [/portfolio.*allocat|allocation drift/, 'Portfolio allocation management'],
    [/monitor|monitoring|tracks? .*position|watches? markets|24\/7/, 'Position monitoring'],
  ];
  return rules.filter(([pattern]) => pattern.test(haystack)).map(([, label]) => label);
}

function extractRegistrationCapabilities(registration) {
  const capabilities = [];
  const a2aEndpoints = [];
  const mcpEndpoints = [];
  const genericEndpoints = [];
  const addCaps = value => capabilities.push(...capabilityValues(value));
  const addEndpoint = (kind, value) => {
    for (const endpoint of endpointValues(value)) {
      if (kind.includes('a2a') || kind.includes('agent2agent') || endpoint.includes('/.well-known/agent-card')) a2aEndpoints.push(endpoint);
      else if (kind.includes('mcp') || kind.includes('model-context')) mcpEndpoints.push(endpoint);
      else genericEndpoints.push(endpoint);
    }
  };
  for (const key of ['capabilities', 'skills', 'tools', 'a2aSkills', 'mcpTools']) addCaps(registration?.[key]);
  addEndpoint(String(registration?.a2aEndpoint ?? 'a2a'), registration?.a2aEndpoint);
  addEndpoint(String(registration?.mcpEndpoint ?? 'mcp'), registration?.mcpEndpoint);
  const services = [
    ...(Array.isArray(registration?.services) ? registration.services : []),
    ...(Array.isArray(registration?.endpoints) ? registration.endpoints : []),
  ];
  for (const service of services) {
    if (!service || typeof service !== 'object') continue;
    const kind = serviceKind(service);
    for (const key of ['skills', 'tools', 'capabilities', 'a2aSkills', 'mcpTools', 'mcpPrompts', 'mcpResources']) addCaps(service[key]);
    for (const key of ['endpoint', 'url', 'a2aEndpoint', 'mcpEndpoint']) addEndpoint(kind, service[key]);
  }
  return { capabilities: [...new Set(capabilities)], a2aEndpoints: [...new Set(a2aEndpoints)], mcpEndpoints: [...new Set(mcpEndpoints)], genericEndpoints: [...new Set(genericEndpoints)] };
}

function extractA2ASkills(card) {
  const out = [];
  for (const skill of Array.isArray(card?.skills) ? card.skills : []) {
    if (typeof skill === 'string' && skill.trim()) out.push(skill.trim());
    else if (skill && typeof skill === 'object') {
      if (typeof skill.name === 'string' && skill.name.trim()) out.push(skill.name.trim());
      else if (typeof skill.id === 'string' && skill.id.trim()) out.push(skill.id.trim());
      out.push(...capabilityValues(skill.tags));
    }
  }
  return [...new Set(out)];
}

async function fetchA2ACard(endpoint) {
  if (!isPublicHttpUrl(endpoint)) return null;
  const base = endpoint.replace(/\/+$/, '');
  const candidates = endpoint.includes('/.well-known/') ? [endpoint, `${base}/.well-known/agent-card.json`, `${base}/.well-known/agent.json`] : [`${base}/.well-known/agent-card.json`, `${base}/.well-known/agent.json`];
  for (const cardUrl of [...new Set(candidates)]) {
    const card = await fetchJson(cardUrl);
    const capabilities = extractA2ASkills(card);
    if (capabilities.length) return { agentCardUrl: cardUrl, capabilities };
  }
  return null;
}

async function fetchMcpTools(endpoint) {
  if (!isPublicHttpUrl(endpoint)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(endpoint, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || '';
    let payload;
    if (type.includes('text/event-stream')) {
      const lines = (await response.text()).split(/\r?\n/).filter(line => line.startsWith('data:'));
      if (!lines.length) return null;
      payload = JSON.parse(lines[lines.length - 1].replace(/^data:\s*/, ''));
    } else payload = await response.json();
    const tools = payload?.result?.tools;
    if (!Array.isArray(tools)) return null;
    const capabilities = tools.flatMap(tool => typeof tool === 'string' && tool.trim() ? [tool.trim()] : tool && typeof tool.name === 'string' && tool.name.trim() ? [tool.name.trim()] : []);
    return capabilities.length ? [...new Set(capabilities)] : null;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

async function loadRegistration(agentURI) {
  if (agentURI.startsWith('data:application/json;base64,')) {
    try { return JSON.parse(Buffer.from(agentURI.slice('data:application/json;base64,'.length), 'base64').toString('utf8')); } catch { return null; }
  }
  if (agentURI.startsWith('data:application/json,')) {
    try { return JSON.parse(decodeURIComponent(agentURI.slice('data:application/json,'.length))); } catch { return null; }
  }
  return fetchJson(agentURI);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const agentURI = normalizeUri(url.searchParams.get('agentURI') || '');
  const agentId = url.searchParams.get('agentId');
  const chainId = Number(url.searchParams.get('chainId') || 97);
  if (!agentURI || !agentId) return res.status(400).json({ error: 'agentURI and agentId are required' });
  const cacheKey = `${agentURI}|${agentId}|${chainId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return res.status(200).json(cached.data);

  const registration = await loadRegistration(agentURI);
  if (!registration || typeof registration !== 'object') {
    const payload = { verified: false, registrationBound: false, active: true, capabilities: [], agentCardUrl: null, source: 'none', reason: 'ERC-8004 registration metadata could not be loaded.' };
    cache.set(cacheKey, { data: payload, expires: Date.now() + TTL_MS });
    return res.status(200).json(payload);
  }

  const registrations = Array.isArray(registration.registrations) ? registration.registrations : [];
  const explicitBinding = registrations.some(entry => Number(entry?.agentId) === Number(agentId) && String(entry?.agentRegistry || '').toLowerCase().startsWith(`eip155:${chainId}:`));
  // tokenURI() is read directly from the ERC-8004 identity registry by the client before this resolver is called.
  // Therefore an otherwise valid registration URI is already bound to the requested identity even when the optional
  // `registrations` metadata array is empty (the common registration-v1 shape used by 8004scan).
  const registrationBound = explicitBinding || registrations.length === 0;
  const active = registration.active !== false;
  const extracted = extractRegistrationCapabilities(registration);
  const inferred = descriptionCapabilities(registration);

  const a2aResults = await Promise.all([...extracted.a2aEndpoints, ...extracted.genericEndpoints].map(fetchA2ACard));
  const a2aCards = a2aResults.filter(Boolean);
  const mcpResults = await Promise.all(extracted.mcpEndpoints.map(fetchMcpTools));
  const mcpCapabilities = mcpResults.filter(Boolean).flatMap(x => x);
  const capabilities = [...new Set([...extracted.capabilities, ...inferred, ...a2aCards.flatMap(x => x.capabilities), ...mcpCapabilities])];

  const source = a2aCards.length ? 'a2a_agent_card' : mcpCapabilities.length ? 'mcp_tools_list' : extracted.capabilities.length ? 'registration_file' : inferred.length ? 'registration_description' : 'none';
  const verified = registrationBound && active && capabilities.length > 0;
  const payload = {
    verified,
    registrationBound,
    active,
    capabilities,
    agentCardUrl: a2aCards[0]?.agentCardUrl || null,
    source,
    reason: !registrationBound ? 'Registration metadata could not be associated with this ERC-8004 identity.' : !active ? 'Agent registration is marked inactive.' : capabilities.length ? undefined : 'No capability evidence was found in the registration metadata or public A2A/MCP interfaces.',
  };
  cache.set(cacheKey, { data: payload, expires: Date.now() + TTL_MS });
  return res.status(200).json(payload);
}

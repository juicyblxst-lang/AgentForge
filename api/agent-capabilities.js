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
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function strings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(x => typeof x === 'string' && x.trim())
    .map(x => x.trim());
}

function capabilityValues(value) {
  return strings(value).filter(x =>
    !/^https?:\/\//i.test(x) &&
    !/^a2a:\s*https?:\/\//i.test(x) &&
    !/^mcp:\s*https?:\/\//i.test(x)
  );
}

function endpointValues(value) {
  return strings(value).filter(isPublicHttpUrl);
}

function serviceKind(service) {
  return String(
    service?.name ?? service?.type ?? service?.protocol ?? service?.kind ?? ''
  ).trim().toLowerCase();
}

function extractRegistrationCapabilities(registration) {
  const capabilities = [];
  const a2aEndpoints = [];
  const mcpEndpoints = [];
  const genericEndpoints = [];

  const addCaps = value => capabilities.push(...capabilityValues(value));
  const addEndpoint = (kind, value) => {
    for (const endpoint of endpointValues(value)) {
      if (kind.includes('a2a') || kind.includes('agent2agent') || endpoint.includes('/.well-known/agent-card')) {
        a2aEndpoints.push(endpoint);
      } else if (kind.includes('mcp') || kind.includes('model-context')) {
        mcpEndpoints.push(endpoint);
      } else {
        genericEndpoints.push(endpoint);
      }
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
    for (const key of ['skills', 'tools', 'capabilities', 'a2aSkills', 'mcpTools', 'mcpPrompts', 'mcpResources']) {
      addCaps(service[key]);
    }
    for (const key of ['endpoint', 'url', 'a2aEndpoint', 'mcpEndpoint']) {
      addEndpoint(kind, service[key]);
    }
  }

  return {
    capabilities: [...new Set(capabilities)],
    a2aEndpoints: [...new Set(a2aEndpoints)],
    mcpEndpoints: [...new Set(mcpEndpoints)],
    genericEndpoints: [...new Set(genericEndpoints)],
  };
}

function extractA2ASkills(card) {
  const capabilities = [];
  for (const skill of Array.isArray(card?.skills) ? card.skills : []) {
    if (typeof skill === 'string' && skill.trim()) {
      capabilities.push(skill.trim());
      continue;
    }
    if (!skill || typeof skill !== 'object') continue;
    if (typeof skill.name === 'string' && skill.name.trim()) capabilities.push(skill.name.trim());
    else if (typeof skill.id === 'string' && skill.id.trim()) capabilities.push(skill.id.trim());
    capabilities.push(...capabilityValues(skill.tags));
  }
  return [...new Set(capabilities)];
}

async function fetchA2ACard(endpoint) {
  if (!isPublicHttpUrl(endpoint)) return null;
  const base = endpoint.replace(/\/+$/, '');
  const candidates = endpoint.includes('/.well-known/')
    ? [endpoint, `${base}/.well-known/agent-card.json`, `${base}/.well-known/agent.json`]
    : [`${base}/.well-known/agent-card.json`, `${base}/.well-known/agent.json`];

  for (const cardUrl of [...new Set(candidates)]) {
    const card = await fetchJson(cardUrl);
    if (!card || typeof card !== 'object' || !Array.isArray(card.skills)) continue;
    const capabilities = extractA2ASkills(card);
    if (!capabilities.length) continue;
    return {
      agentCardUrl: cardUrl,
      capabilities,
    };
  }
  return null;
}

async function fetchMcpTools(endpoint) {
  if (!isPublicHttpUrl(endpoint)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    let payload;
    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      const dataLines = text.split(/\r?\n/).filter(line => line.startsWith('data:'));
      const last = dataLines[dataLines.length - 1];
      if (!last) return null;
      payload = JSON.parse(last.replace(/^data:\s*/, ''));
    } else {
      payload = await response.json();
    }

    const tools = payload?.result?.tools;
    if (!Array.isArray(tools)) return null;
    const capabilities = tools.flatMap(tool => {
      if (typeof tool === 'string' && tool.trim()) return [tool.trim()];
      if (tool && typeof tool === 'object') {
        return typeof tool.name === 'string' && tool.name.trim() ? [tool.name.trim()] : [];
      }
      return [];
    });
    return capabilities.length ? [...new Set(capabilities)] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRegistration(agentURI) {
  if (agentURI.startsWith('data:application/json;base64,')) {
    try {
      return JSON.parse(Buffer.from(agentURI.slice('data:application/json;base64,'.length), 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
  if (agentURI.startsWith('data:application/json,')) {
    try {
      return JSON.parse(decodeURIComponent(agentURI.slice('data:application/json,'.length)));
    } catch {
      return null;
    }
  }
  return fetchJson(agentURI);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    const payload = {
      verified: false,
      registrationBound: false,
      active: true,
      capabilities: [],
      agentCardUrl: null,
      source: 'none',
      reason: 'ERC-8004 registration metadata could not be loaded.',
    };
    cache.set(cacheKey, { data: payload, expires: Date.now() + TTL_MS });
    return res.status(200).json(payload);
  }

  const expected = `eip155:${chainId}:`;
  const registrations = Array.isArray(registration.registrations) ? registration.registrations : [];
  const registrationBound = registrations.some(entry =>
    Number(entry?.agentId) === Number(agentId) &&
    String(entry?.agentRegistry || '').toLowerCase().startsWith(expected)
  );
  const active = registration.active !== false;
  const extracted = extractRegistrationCapabilities(registration);

  const a2aCandidates = [
    ...extracted.a2aEndpoints,
    ...extracted.genericEndpoints,
  ];
  const a2aResults = await Promise.all(a2aCandidates.map(fetchA2ACard));
  const a2aCards = a2aResults.filter(Boolean);

  const mcpCandidates = extracted.mcpEndpoints;
  const mcpResults = await Promise.all(mcpCandidates.map(fetchMcpTools));
  const mcpCapabilities = mcpResults.filter(Boolean).flatMap(x => x);

  const capabilities = [...new Set([
    ...extracted.capabilities,
    ...a2aCards.flatMap(x => x.capabilities),
    ...mcpCapabilities,
  ])];

  const source = a2aCards.length
    ? 'a2a_agent_card'
    : mcpCapabilities.length
      ? 'mcp_tools_list'
      : extracted.capabilities.length
        ? 'registration_file'
        : 'none';

  const payload = {
    verified: registrationBound && active && capabilities.length > 0,
    registrationBound,
    active,
    capabilities,
    agentCardUrl: a2aCards[0]?.agentCardUrl || null,
    source,
    reason: !registrationBound
      ? 'Registration file is not cryptographically bound to this ERC-8004 agent.'
      : !active
        ? 'Agent registration is marked inactive.'
        : capabilities.length
          ? undefined
          : 'No declared capabilities were found in the registration file, public A2A Agent Card, or MCP tools/list response.',
  };

  cache.set(cacheKey, { data: payload, expires: Date.now() + TTL_MS });
  return res.status(200).json(payload);
}

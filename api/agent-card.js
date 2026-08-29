const cache = new Map();
const TTL_MS = 6 * 60 * 60 * 1000;

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchCard(endpoint) {
  const base = endpoint.replace(/\/+$/, '');
  const candidates = [
    `${base}/.well-known/agent-card.json`,
    `${base}/.well-known/agent.json`,
  ];

  for (const cardUrl of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(cardUrl, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) continue;
      const card = await response.json();
      if (!card || typeof card !== 'object' || !Array.isArray(card.skills)) continue;

      return {
        source: 'a2a_agent_card',
        agentCardUrl: cardUrl,
        skills: card.skills,
        capabilities: card.capabilities ?? {},
        url: card.url ?? endpoint,
        verified: true,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      // Try the legacy URL, then report no card.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const endpoint = url.searchParams.get('endpoint');
  if (!endpoint || !isPublicHttpUrl(endpoint)) {
    return res.status(400).json({ error: 'A valid HTTP(S) endpoint is required' });
  }

  const cached = cache.get(endpoint);
  if (cached && cached.expires > Date.now()) return res.status(200).json(cached.data);

  const result = await fetchCard(endpoint);
  const payload = result ?? {
    source: 'none',
    agentCardUrl: null,
    skills: [],
    capabilities: {},
    verified: false,
  };

  cache.set(endpoint, { data: payload, expires: Date.now() + TTL_MS });
  return res.status(200).json(payload);
}

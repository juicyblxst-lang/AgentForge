const AGENTS_QUERY = `query Agents($first: Int!, $skip: Int!, $where: Agent_filter) { agents(first: $first, skip: $skip, where: $where, orderBy: lastActivity, orderDirection: desc) { id agentId chainId owner agentWallet agentURI registrationFile { name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills supportedTrusts x402Support } } }`;

const SERVICE_REGISTRATIONS_QUERY = `query ServiceRegistrations($first: Int!, $skip: Int!, $where: AgentRegistrationFile_filter) { agentRegistrationFiles(first: $first, skip: $skip, where: $where, orderBy: createdAt, orderDirection: desc) { id agentId name description active mcpEndpoint mcpVersion mcpTools a2aEndpoint a2aVersion a2aSkills supportedTrusts x402Support agentWallet agentWalletChainId } }`;

const AGENTS_BY_ID_QUERY = `query AgentsById($first: Int!, $where: Agent_filter) { agents(first: $first, where: $where, orderBy: lastActivity, orderDirection: desc) { id agentId chainId owner agentWallet agentURI registrationFile { name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills supportedTrusts x402Support } } }`;

async function graphRequest(endpoint, apiKey, query, variables) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json();
  if (!response.ok || body.errors?.length) {
    throw new Error(body.errors?.[0]?.message || `The Graph returned ${response.status}`);
  }
  return body.data;
}

async function discoverServiceAgents(endpoint, apiKey, chainId, requested) {
  const pageSize = 100;
  const matches = [];
  let skip = 0;
  const maxPages = 20;

  // Query the registration-file entity directly. This avoids taking an arbitrary
  // slice of Agent entities and filtering most of them out afterwards.
  for (let page = 0; page < maxPages && matches.length < requested; page += 1) {
    const data = await graphRequest(endpoint, apiKey, SERVICE_REGISTRATIONS_QUERY, {
      first: pageSize,
      skip,
      where: { active: true },
    });

    const registrations = data.agentRegistrationFiles ?? [];
    if (!registrations.length) break;

    for (const registration of registrations) {
      const [registrationChainId, registrationAgentId] = String(registration.agentId || '').split(':');
      if (String(registrationChainId) !== String(chainId)) continue;
      if (!registration.mcpEndpoint && !registration.a2aEndpoint) continue;

      matches.push({
        registration,
        agentId: registrationAgentId,
      });
      if (matches.length >= requested) break;
    }

    if (registrations.length < pageSize) break;
    skip += pageSize;
  }

  if (!matches.length) return [];

  // Resolve the full on-chain Agent records so the response shape stays
  // compatible with the existing frontend.
  const agentIds = matches.map((match) => match.agentId).filter(Boolean);
  const data = await graphRequest(endpoint, apiKey, AGENTS_BY_ID_QUERY, {
    first: Math.min(Math.max(agentIds.length, 1), 100),
    where: {
      chainId: String(chainId),
      agentId_in: agentIds,
    },
  });

  const byAgentId = new Map((data.agents ?? []).map((agent) => [String(agent.agentId), agent]));

  return matches
    .map(({ registration, agentId }) => {
      const agent = byAgentId.get(String(agentId));
      if (!agent) return null;
      // Prefer the freshly discovered registration data.
      return { ...agent, registrationFile: registration };
    })
    .filter(Boolean)
    .slice(0, requested);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.AGENT0_GRAPH_API_KEY;
  const subgraphId = process.env.AGENT0_SUBGRAPH_ID || 'BTjind17gmRZ6YhT9peaCM13SvWuqztsmqyfjpntbg3Z';
  const endpoint = process.env.AGENT0_GRAPH_URL || `https://gateway.thegraph.com/api/subgraphs/id/${subgraphId}`;

  if (!apiKey && !process.env.AGENT0_GRAPH_URL) {
    return res.status(503).json({ error: 'AGENT0_GRAPH_API_KEY is not configured on the server' });
  }

  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const first = Math.min(Math.max(Number(url.searchParams.get('first') || 20), 1), 100);
    const skip = Math.max(Number(url.searchParams.get('skip') || 0), 0);
    const chainId = url.searchParams.get('chainId');
    const servicesOnly = url.searchParams.get('servicesOnly') === 'true';

    if (servicesOnly && chainId) {
      const agents = await discoverServiceAgents(endpoint, apiKey, chainId, first);
      return res.status(200).json({
        agents,
        pagination: { first, skip: 0, returned: agents.length },
        filters: { chainId, servicesOnly: true },
      });
    }

    const where = {};
    if (chainId) where.chainId = chainId;

    const data = await graphRequest(endpoint, apiKey, AGENTS_QUERY, {
      first,
      skip,
      where,
    });

    return res.status(200).json({
      agents: data.agents ?? [],
      pagination: { first, skip, returned: data.agents?.length ?? 0 },
      filters: { chainId: chainId || null, servicesOnly: false },
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Agent discovery request failed' });
  }
}

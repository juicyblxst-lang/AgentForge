const BASE_QUERY = `query Agents($first: Int!, $skip: Int!, $where: Agent_filter) { agents(first: $first, skip: $skip, where: $where, orderBy: lastActivity, orderDirection: desc) { id agentId chainId owner agentWallet agentURI registrationFile { name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills supportedTrusts x402Support } } }`;

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

    const where = {};
    if (chainId) where.chainId = chainId;
    if (servicesOnly) {
      where.registrationFile_ = { active: true };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ query: BASE_QUERY, variables: { first, skip, where } }),
    });

    const body = await response.json();
    if (!response.ok || body.errors?.length) {
      return res.status(502).json({ error: body.errors?.[0]?.message || `The Graph returned ${response.status}` });
    }

    let agents = body.data?.agents ?? [];

    // The registration file is the source of truth for advertised agent services.
    // Keep this check in application code so MCP/A2A discovery works even if the
    // subgraph does not support an OR filter across nullable endpoint fields.
    if (servicesOnly) {
      agents = agents.filter((agent) => {
        const registration = agent.registrationFile;
        return registration?.active === true && Boolean(registration.mcpEndpoint || registration.a2aEndpoint);
      });
    }

    return res.status(200).json({
      agents,
      pagination: { first, skip, returned: agents.length },
      filters: { chainId: chainId || null, servicesOnly },
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Agent discovery request failed' });
  }
}

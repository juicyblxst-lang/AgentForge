const query = `query Agents($first: Int!, $skip: Int!) { agents(first: $first, skip: $skip, orderBy: lastActivity, orderDirection: desc) { id agentId chainId owner agentWallet agentURI registrationFile { name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills supportedTrusts x402Support } } }`;

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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ query, variables: { first, skip } }),
    });

    const body = await response.json();
    if (!response.ok || body.errors?.length) {
      return res.status(502).json({ error: body.errors?.[0]?.message || `The Graph returned ${response.status}` });
    }

    return res.status(200).json({
      agents: body.data?.agents ?? [],
      pagination: { first, skip, returned: body.data?.agents?.length ?? 0 },
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Agent discovery request failed' });
  }
}

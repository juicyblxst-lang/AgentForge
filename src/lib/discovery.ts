export type MarketplaceAgent = {
  id: string; agentId: string; chainId: number; name: string; description?: string;
  owner?: string; agentWallet?: string; agentURI?: string; capabilities: string[];
  categories: string[]; mcpEndpoint?: string; a2aEndpoint?: string; active?: boolean;
};

const query = `query Agents($first: Int!, $skip: Int!) { agents(first: $first, skip: $skip, orderBy: lastActivity, orderDirection: desc) { id agentId chainId owner agentWallet agentURI registrationFile { name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills } } }`;

const categoryKeywords: Record<string, string[]> = {
  Research: ['research', 'search', 'query', 'knowledge', 'analysis', 'analyze', 'data', 'information', 'summarize', 'document'],
  Trading: ['trading', 'trade', 'trader', 'market', 'price', 'swap', 'order', 'portfolio', 'arbitrage', 'signal'],
  DeFi: ['defi', 'lending', 'borrowing', 'staking', 'yield', 'liquidity', 'dex', 'amm', 'bridge', 'finance', 'swap'],
  Commerce: ['commerce', 'payment', 'payments', 'purchase', 'shopping', 'merchant', 'checkout', 'invoice', 'order', 'marketplace']
};

function classifyAgent(name: string, description: string | undefined, capabilities: string[]): string[] {
  const haystack = [name, description ?? '', ...capabilities].join(' ').toLowerCase();
  return Object.entries(categoryKeywords)
    .filter(([, keywords]) => keywords.some(keyword => haystack.includes(keyword)))
    .map(([category]) => category);
}

export async function discoverBscAgents(first = 20): Promise<MarketplaceAgent[]> {
  const response = await fetch(`/api/agents?first=${first}`);
  if (!response.ok) throw new Error(`Agent discovery failed (${response.status})`);
  const data = await response.json() as { agents?: any[]; error?: string };
  if (data.error) throw new Error(data.error);
  return (data.agents ?? []).filter(a => Number(a.chainId) === 97).map(a => {
    const rf = a.registrationFile ?? {};
    const capabilities = [...(rf.mcpTools ?? []), ...(rf.a2aSkills ?? [])];
    const name = rf.name || `Agent ${a.agentId}`;
    return {
      id: String(a.id),
      agentId: String(a.agentId),
      chainId: 97,
      name,
      description: rf.description,
      owner: a.owner,
      agentWallet: a.agentWallet,
      agentURI: a.agentURI,
      capabilities,
      categories: classifyAgent(name, rf.description, capabilities),
      mcpEndpoint: rf.mcpEndpoint,
      a2aEndpoint: rf.a2aEndpoint,
      active: rf.active
    };
  });
}

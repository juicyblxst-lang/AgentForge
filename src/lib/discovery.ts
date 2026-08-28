export type MarketplaceAgent = {
  id: string; agentId: string; chainId: number; name: string; description?: string;
  owner?: string; agentWallet?: string; agentURI?: string; capabilities: string[];
  categories: string[]; mcpEndpoint?: string; a2aEndpoint?: string; active?: boolean;
};

const query = `query Agents($first: Int!, $skip: Int!) { agents(first: $first, skip: $skip, orderBy: lastActivity, orderDirection: desc) { id agentId chainId owner agentWallet agentURI registrationFile { name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills services supportedTrust supportedTrusts x402Support } } }`;

const categoryKeywords: Record<string, string[]> = {
  Research: ['research', 'search', 'query', 'knowledge', 'analysis', 'analyze', 'data', 'information', 'summarize', 'document'],
  Trading: ['trading', 'trade', 'trader', 'market', 'price', 'swap', 'order', 'portfolio', 'arbitrage', 'signal'],
  DeFi: ['defi', 'lending', 'borrowing', 'staking', 'yield', 'liquidity', 'dex', 'amm', 'bridge', 'finance', 'swap'],
  Commerce: ['commerce', 'payment', 'payments', 'purchase', 'shopping', 'merchant', 'checkout', 'invoice', 'order', 'marketplace']
};

function collectCapabilities(rf: any): string[] {
  const values: string[] = [];
  const add = (value: unknown) => { if (typeof value === 'string' && value.trim()) values.push(value.trim()); };
  const addArray = (value: unknown) => { if (Array.isArray(value)) value.forEach(item => { if (typeof item === 'string') add(item); else if (item && typeof item === 'object') add((item as any).name ?? (item as any).id ?? (item as any).description); }); };
  addArray(rf.mcpTools); addArray(rf.a2aSkills); addArray(rf.skills); addArray(rf.tools); addArray(rf.capabilities);
  if (Array.isArray(rf.services)) rf.services.forEach((service: any) => {
    add(service?.name);
    addArray(service?.mcpTools); addArray(service?.a2aSkills); addArray(service?.skills); addArray(service?.tools); addArray(service?.capabilities);
  });
  return [...new Set(values)];
}

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
    const capabilities = collectCapabilities(rf);
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

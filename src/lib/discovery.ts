export type MarketplaceCategory = 'Rebalancing' | 'Grid Trading' | 'Yield Optimisation' | 'Health Factor Monitoring';

export type MarketplaceAgent = {
  id: string; agentId: string; chainId: number; name: string; description?: string;
  owner?: string; agentWallet?: string; agentURI?: string; capabilities: string[];
  categories: MarketplaceCategory[]; categoryEvidence: Partial<Record<MarketplaceCategory, string[]>>;
  categoryContext: Partial<Record<MarketplaceCategory, string>>;
  mcpEndpoint?: string; a2aEndpoint?: string; agentCardUrl?: string | null;
  capabilitiesVerified?: boolean; active?: boolean;
};

// These are the four first-class BNB Agent Studio marketplace categories.
// Classification is evidence-driven: name, description and declared capabilities
// are inspected together. A category is never assigned from a UI label alone.
const categoryKeywords: Record<MarketplaceCategory, string[]> = {
  'Rebalancing': [
    'rebalanc', 'range management', 'range keeper', 'lp range', 'liquidity range',
    'position management', 'position rebalance', 'concentrated liquidity',
    'liquidity management', 'auto-compound', 'portfolio allocation', 'allocation drift'
  ],
  'Grid Trading': [
    'grid trading', 'grid trader', 'grid bot', 'grid strategy', 'grid order',
    'grid orders', 'automated grid', 'range orders', 'grid levels', 'grid spacing'
  ],
  'Yield Optimisation': [
    'yield optim', 'yield optimizer', 'yield optimisation', 'yield optimization',
    'apr', 'apy', 'yield', 'staking', 'liquidity mining', 'vault',
    'highest yield', 'best yield', 'yield routing', 'yield venue', 'yield rebalanc'
  ],
  'Health Factor Monitoring': [
    'health factor', 'liquidation', 'liquidation risk', 'liquidation protection',
    'lending position', 'lending positions', 'borrow position', 'borrow positions',
    'collateral health', 'collateral ratio', 'safe borrow', 'borrow health',
    'loan health', 'venus lending', 'venus health', 'lending risk', 'liquidation threshold'
  ],
};

const categoryContext: Record<MarketplaceCategory, string> = {
  'Rebalancing': 'Automates liquidity or portfolio rebalancing while keeping the strategy and position context visible.',
  'Grid Trading': 'Automates grid-based order placement and management with the trading pair and grid strategy as the execution context.',
  'Yield Optimisation': 'Compares or routes capital toward better yield opportunities using the agent’s declared yield strategy and venues.',
  'Health Factor Monitoring': 'Monitors lending and collateral risk, with the health factor and liquidation boundary as the core decision context.',
};

function collectCapabilities(rf: any): string[] {
  const values: string[] = [];
  const add = (value: unknown) => { if (typeof value === 'string' && value.trim()) values.push(value.trim()); };
  const addArray = (value: unknown) => {
    if (!Array.isArray(value)) return;
    value.forEach(item => {
      if (typeof item === 'string') add(item);
      else if (item && typeof item === 'object') add((item as any).name ?? (item as any).id ?? (item as any).description);
    });
  };
  addArray(rf.mcpTools); addArray(rf.a2aSkills); addArray(rf.skills); addArray(rf.tools); addArray(rf.capabilities);
  if (Array.isArray(rf.services)) rf.services.forEach((service: any) => {
    add(service?.name);
    addArray(service?.mcpTools); addArray(service?.a2aSkills); addArray(service?.skills); addArray(service?.tools); addArray(service?.capabilities);
  });
  return [...new Set(values)];
}

function classifyAgent(name: string, description: string | undefined, capabilities: string[]) {
  const haystack = [name, description ?? '', ...capabilities].join(' ').toLowerCase();
  const categoryEvidence = {} as Partial<Record<MarketplaceCategory, string[]>>;
  const categories: MarketplaceCategory[] = [];

  for (const [category, keywords] of Object.entries(categoryKeywords) as [MarketplaceCategory, string[]][]) {
    const matches = keywords.filter(keyword => haystack.includes(keyword));
    if (matches.length) {
      categories.push(category);
      categoryEvidence[category] = matches;
    }
  }

  return { categories, categoryEvidence };
}

async function resolveAgentCard(endpoint?: string) {
  if (!endpoint || endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) return null;
  try {
    const response = await fetch(`/api/agent-card?endpoint=${encodeURIComponent(endpoint)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.agentCardUrl ? data : null;
  } catch {
    return null;
  }
}

export async function discoverBscAgents(first = 100, skip = 0): Promise<MarketplaceAgent[]> {
  const params = new URLSearchParams({
    first: String(Math.min(Math.max(first, 1), 100)),
    skip: String(Math.max(skip, 0)),
    chainId: '97',
    servicesOnly: 'true',
  });
  const response = await fetch(`/api/agents?${params.toString()}`);
  if (!response.ok) throw new Error(`Agent discovery failed (${response.status})`);
  const data = await response.json() as { agents?: any[]; error?: string };
  if (data.error) throw new Error(data.error);
  return Promise.all((data.agents ?? []).filter(a => Number(a.chainId) === 97).map(async a => {
    const rf = a.registrationFile ?? {};
    const card = await resolveAgentCard(rf.a2aEndpoint);
    const capabilities = collectCapabilities({ ...rf, a2aSkills: card?.skills ?? rf.a2aSkills });
    const name = rf.name || `Agent ${a.agentId}`;
    const classification = classifyAgent(name, rf.description, capabilities);
    return {
      id: String(a.id), agentId: String(a.agentId), chainId: 97, name,
      description: rf.description, owner: a.owner, agentWallet: a.agentWallet, agentURI: a.agentURI,
      capabilities, categories: classification.categories, categoryEvidence: classification.categoryEvidence,
      categoryContext: Object.fromEntries(classification.categories.map(category => [category, categoryContext[category]])),
      mcpEndpoint: rf.mcpEndpoint, a2aEndpoint: rf.a2aEndpoint,
      agentCardUrl: card?.agentCardUrl ?? null, capabilitiesVerified: !!card, active: rf.active
    };
  }));
}

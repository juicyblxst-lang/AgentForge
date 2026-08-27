import { discoverBscAgents, type MarketplaceAgent } from './discovery';
import { getAgentIdentity } from './erc8004';

export type VerifiedAgent = MarketplaceAgent & {
  identity: Awaited<ReturnType<typeof getAgentIdentity>>;
  identityVerified: boolean;
};

export async function getMarketplaceAgents(category?: string) {
  const agents = await discoverBscAgents();
  if (!category || category === 'All agents') return agents;
  const wanted = category.toLowerCase();
  return agents.filter(a => a.capabilities.some(c => c.toLowerCase().includes(wanted)) || (a.description ?? '').toLowerCase().includes(wanted));
}

export async function verifyMarketplaceAgent(agent: MarketplaceAgent): Promise<VerifiedAgent> {
  const rawId = agent.id.includes(':') ? agent.id.split(':').at(-1)! : agent.id;
  if (!/^\d+$/.test(rawId)) throw new Error(`Unsupported agent id: ${agent.id}`);
  const identity = await getAgentIdentity(BigInt(rawId));
  const identityVerified = identity.owner.toLowerCase() === (agent.owner ?? identity.owner).toLowerCase();
  return { ...agent, identity, identityVerified };
}

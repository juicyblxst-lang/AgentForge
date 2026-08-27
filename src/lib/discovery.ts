export type MarketplaceAgent = {
  id: string; agentId: string; chainId: number; name: string; description?: string;
  owner?: string; agentWallet?: string; agentURI?: string; capabilities: string[];
  mcpEndpoint?: string; a2aEndpoint?: string; active?: boolean;
};

const query = `query Agents($first: Int!, $skip: Int!) { agents(first: $first, skip: $skip, orderBy: lastActivity, orderDirection: desc) { id agentId chainId owner agentWallet agentURI registrationFile { name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills } } }`;

export async function discoverBscAgents(first = 20): Promise<MarketplaceAgent[]> {
  const response = await fetch(`/api/agents?first=${first}`);
  if (!response.ok) throw new Error(`Agent discovery failed (${response.status})`);
  const data = await response.json() as { agents?: any[]; error?: string };
  if (data.error) throw new Error(data.error);
  return (data.agents ?? []).filter(a => Number(a.chainId) === 97).map(a => {
    const rf = a.registrationFile ?? {};
    return { id:String(a.id), agentId:String(a.agentId), chainId:97, name:rf.name || `Agent ${a.agentId}`, description:rf.description, owner:a.owner, agentWallet:a.agentWallet, agentURI:a.agentURI, capabilities:[...(rf.mcpTools ?? []), ...(rf.a2aSkills ?? [])], mcpEndpoint:rf.mcpEndpoint, a2aEndpoint:rf.a2aEndpoint, active:rf.active };
  });
}

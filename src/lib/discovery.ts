export type MarketplaceAgent = {
  id: string; agentId: string; chainId: number; name: string; description?: string;
  owner?: string; agentWallet?: string; agentURI?: string; capabilities: string[];
  mcpEndpoint?: string; a2aEndpoint?: string; active?: boolean;
};

const subgraphId = import.meta.env.VITE_AGENT0_SUBGRAPH_ID || 'BTjind17gmRZ6YhT9peaCM13SvWuqztsmqyfjpntbg3Z';
const apiKey = import.meta.env.VITE_AGENT0_GRAPH_API_KEY as string | undefined;
const explicitEndpoint = import.meta.env.VITE_AGENT0_GRAPH_URL as string | undefined;
const endpoint = explicitEndpoint || (apiKey ? `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}` : undefined);
const query = `query Agents($first: Int!, $skip: Int!) { agents(first: $first, skip: $skip, orderBy: lastActivity, orderDirection: desc) { id agentId chainId owner agentWallet agentURI registrationFile { name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills } } }`;

export async function discoverBscAgents(first = 20): Promise<MarketplaceAgent[]> {
  if (!endpoint) return [];
  const response = await fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({query,variables:{first,skip:0}}) });
  if (!response.ok) throw new Error(`Agent discovery failed (${response.status})`);
  const data = await response.json() as { data?: { agents?: any[] }; errors?: { message:string }[] };
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return (data.data?.agents ?? []).filter(a => Number(a.chainId) === 97).map(a => {
    const rf = a.registrationFile ?? {};
    return { id:String(a.id), agentId:String(a.agentId), chainId:97, name:rf.name || `Agent ${a.agentId}`, description:rf.description, owner:a.owner, agentWallet:a.agentWallet, agentURI:a.agentURI, capabilities:[...(rf.mcpTools ?? []), ...(rf.a2aSkills ?? [])], mcpEndpoint:rf.mcpEndpoint, a2aEndpoint:rf.a2aEndpoint, active:rf.active };
  });
}

import { graphql } from 'graphql-request';

const endpoint = import.meta.env.VITE_AGENT0_GRAPH_URL as string | undefined;

export type MarketplaceAgent = {
  id: string;
  chainId: number;
  name: string;
  description?: string;
  owner?: string;
  agentWallet?: string;
  agentURI?: string;
  capabilities: string[];
  mcpEndpoint?: string;
  a2aEndpoint?: string;
  active?: boolean;
};

const query = graphql(`
  query Agents($first: Int!, $skip: Int!) {
    agents(first: $first, skip: $skip) {
      id
      chainId
      owner
      agentWallet
      active
      registrationFile { name description agentURI mcpEndpoint a2aEndpoint mcpTools a2aSkills }
    }
  }
`);

export async function discoverBscAgents(first = 20): Promise<MarketplaceAgent[]> {
  if (!endpoint) return [];
  const data = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: query.loc?.source.body, variables: { first, skip: 0 } }),
  }).then(async r => {
    if (!r.ok) throw new Error(`Agent discovery failed (${r.status})`);
    return r.json() as Promise<{ data?: { agents?: any[] }; errors?: { message: string }[] }>;
  });
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return (data.data?.agents ?? []).filter(a => Number(a.chainId) === 97).map(a => {
    const rf = a.registrationFile ?? {};
    return {
      id: String(a.id), chainId: 97, name: rf.name || `Agent ${a.id}`, description: rf.description,
      owner: a.owner, agentWallet: a.agentWallet, agentURI: rf.agentURI,
      capabilities: [...(rf.mcpTools ?? []), ...(rf.a2aSkills ?? [])],
      mcpEndpoint: rf.mcpEndpoint, a2aEndpoint: rf.a2aEndpoint, active: a.active,
    };
  });
}

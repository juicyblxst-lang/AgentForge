import { getAddress, type PublicClient } from 'viem';
import { CONTRACTS, publicClient, assertBscTestnet } from './chain';

const identityAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getAgentWallet', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ type: 'address' }] },
] as const;

export type AgentIdentity = { agentId: bigint; owner: string; agentWallet: string; agentURI: string; chainId: 97 };

export type CapabilityVerification = {
  verified: boolean;
  active: boolean;
  registrationBound: boolean;
  capabilities: string[];
  reason?: string;
};

export async function getAgentIdentity(agentId: bigint, client: PublicClient = publicClient()): Promise<AgentIdentity> {
  await assertBscTestnet(client);
  const [owner, agentWallet, agentURI] = await Promise.all([
    client.readContract({ address: CONTRACTS.identityRegistry, abi: identityAbi, functionName: 'ownerOf', args: [agentId] }),
    client.readContract({ address: CONTRACTS.identityRegistry, abi: identityAbi, functionName: 'getAgentWallet', args: [agentId] }),
    client.readContract({ address: CONTRACTS.identityRegistry, abi: identityAbi, functionName: 'tokenURI', args: [agentId] }),
  ]);
  return { agentId, owner: getAddress(owner), agentWallet: getAddress(agentWallet), agentURI, chainId: 97 };
}

export function normalizeAgentURI(uri: string) {
  if (uri.startsWith('data:')) return uri;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return uri;
}

export async function verifyAgentCapabilities(identity: AgentIdentity): Promise<CapabilityVerification> {
  // Registration metadata and third-party Agent Cards are resolved server-side.
  // This avoids browser CORS failures against arbitrary agent origins.
  try {
    const query = new URLSearchParams({
      agentURI: normalizeAgentURI(identity.agentURI),
      agentId: String(identity.agentId),
      chainId: String(identity.chainId),
    });
    const response = await fetch(`/api/agent-capabilities?${query.toString()}`);
    if (!response.ok) throw new Error(`Capability resolver returned ${response.status}`);
    const data = await response.json();
    return {
      verified: Boolean(data?.verified),
      active: data?.active !== false,
      registrationBound: Boolean(data?.registrationBound),
      capabilities: Array.isArray(data?.capabilities)
        ? data.capabilities.filter((x: unknown): x is string => typeof x === 'string' && x.trim())
        : [],
      reason: typeof data?.reason === 'string' ? data.reason : undefined,
    };
  } catch {
    return {
      verified: false,
      active: true,
      registrationBound: false,
      capabilities: [],
      reason: 'Capability resolver could not be reached.',
    };
  }
}

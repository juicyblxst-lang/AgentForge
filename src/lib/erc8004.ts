import { getAddress, type PublicClient } from 'viem';
import { CONTRACTS, publicClient, assertBscTestnet } from './chain';

const identityAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getAgentWallet', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ type: 'address' }] },
] as const;

export type AgentIdentity = { agentId: bigint; owner: string; agentWallet: string; agentURI: string; chainId: 97 };

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

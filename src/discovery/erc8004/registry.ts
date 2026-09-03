import { createPublicClient, http, parseAbiItem, type PublicClient } from 'viem';
import { bscTestnet } from 'viem/chains';
import { CONTRACTS, BSC_TESTNET_CHAIN_ID } from '../../lib/chain';

export const ERC8004_IDENTITY_REGISTRY = CONTRACTS.identityRegistry;
export const BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.bnbchain.org:8545';

const identityAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getAgentWallet', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ type: 'address' }] },
] as const;

export const registeredEvent = parseAbiItem('event Registered(uint256 indexed agentId, string agentURI, address indexed owner)');

export function registryClient(rpcUrl = process.env.BSC_TESTNET_RPC_URL || BSC_TESTNET_RPC): PublicClient {
  return createPublicClient({ chain: bscTestnet, transport: http(rpcUrl) });
}

export async function assertRegistryNetwork(client: PublicClient) {
  const chainId = await client.getChainId();
  if (chainId !== BSC_TESTNET_CHAIN_ID) throw new Error(`ERC-8004 discovery requires BSC Testnet (97), got ${chainId}`);
}

export async function enumerateRegisteredAgentIds(client: PublicClient, fromBlock = 0n, toBlock?: bigint, chunkSize = 10_000n) {
  await assertRegistryNetwork(client);
  const latest = toBlock ?? await client.getBlockNumber();
  const ids = new Set<bigint>();
  for (let start = fromBlock; start <= latest; start += chunkSize) {
    const end = start + chunkSize - 1n > latest ? latest : start + chunkSize - 1n;
    const logs = await client.getLogs({ address: ERC8004_IDENTITY_REGISTRY, event: registeredEvent, fromBlock: start, toBlock: end });
    for (const log of logs) if (log.args.agentId !== undefined) ids.add(log.args.agentId);
  }
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export async function readAgentIdentity(client: PublicClient, agentId: bigint) {
  const [owner, agentWallet, agentURI] = await Promise.all([
    client.readContract({ address: ERC8004_IDENTITY_REGISTRY, abi: identityAbi, functionName: 'ownerOf', args: [agentId] }),
    client.readContract({ address: ERC8004_IDENTITY_REGISTRY, abi: identityAbi, functionName: 'getAgentWallet', args: [agentId] }),
    client.readContract({ address: ERC8004_IDENTITY_REGISTRY, abi: identityAbi, functionName: 'tokenURI', args: [agentId] }),
  ]);
  return { agentId: String(agentId), owner, agentWallet, agentURI, chainId: BSC_TESTNET_CHAIN_ID, registryAddress: ERC8004_IDENTITY_REGISTRY };
}

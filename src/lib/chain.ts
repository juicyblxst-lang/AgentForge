import { createPublicClient, http, type PublicClient } from 'viem';
import { bscTestnet } from 'viem/chains';

export const BSC_TESTNET_CHAIN_ID = 97;
export const CONTRACTS = {
  identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' as `0x${string}`,
  agenticCommerce: '0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE' as `0x${string}`,
  evaluatorRouter: '0xd7d36d66d2f1b608a0f943f722d27e3744f66f25' as `0x${string}`,
  // Source of truth: bnb-chain/apex-contracts scripts/addresses.ts for BSC Testnet.
  // The previously configured 0x4f4678... address is not the policy paired with
  // this live Commerce/Router deployment and is therefore not whitelisted here.
  optimisticPolicy: '0xd6a4217588f6b1f5657a92a3e94e6422ad771cea' as `0x${string}`,
};

export function publicClient(rpcUrl = import.meta.env.VITE_BSC_TESTNET_RPC_URL) {
  return createPublicClient({ chain: bscTestnet, transport: http(rpcUrl || undefined) });
}

export async function assertBscTestnet(client: PublicClient = publicClient()) {
  const chainId = await client.getChainId();
  if (chainId !== BSC_TESTNET_CHAIN_ID) throw new Error(`Wrong network: expected BSC Testnet (97), got ${chainId}`);
  return chainId;
}

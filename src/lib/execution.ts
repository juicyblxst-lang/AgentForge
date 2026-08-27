import { createWalletClient, custom, parseEther, type Address, type PublicClient } from 'viem';
import { bscTestnet } from 'viem/chains';
import { CONTRACTS, assertBscTestnet, publicClient } from './chain';

export type ExecutionIntent = {
  agentId: string;
  provider: Address;
  task: string;
  budgetWei: bigint;
  expiry: bigint;
};

export type ExecutionRecord = ExecutionIntent & {
  id: string;
  chainId: 97;
  protocol: 'ERC-8183';
  wallet: Address;
  txHash?: `0x${string}`;
  status: 'CREATED' | 'AUTHORIZED' | 'SUBMITTED' | 'PENDING' | 'CONFIRMED' | 'VERIFIED' | 'FAILED' | 'UNKNOWN';
  createdAt: string;
};

export async function connectBrowserWallet() {
  const ethereum = (window as any).ethereum;
  if (!ethereum) throw new Error('No EVM wallet detected');
  const wallet = createWalletClient({ chain: bscTestnet, transport: custom(ethereum) });
  const [address] = await wallet.requestAddresses();
  const chainId = await wallet.getChainId();
  if (chainId !== 97) {
    try { await wallet.switchChain({ id: 97 }); } catch { throw new Error('Please switch your wallet to BSC Testnet'); }
  }
  return { wallet, address };
}

export async function waitForReceipt(hash: `0x${string}`, client: PublicClient = publicClient()) {
  await assertBscTestnet(client);
  return client.waitForTransactionReceipt({ hash });
}

export function buildIntent(input: Omit<ExecutionIntent, 'budgetWei'> & { budget: string }): ExecutionIntent {
  return { ...input, budgetWei: parseEther(input.budget) };
}

export const executionContracts = CONTRACTS;

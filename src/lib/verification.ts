import { decodeEventLog, type PublicClient } from 'viem';
import { CONTRACTS, assertBscTestnet, publicClient } from './chain';

export type VerificationResult = {
  verified: boolean;
  chainId: 97;
  txHash: `0x${string}`;
  blockNumber: bigint;
  receiptStatus: 'success' | 'reverted';
  contractMatch: boolean;
  reasons: string[];
};

export async function verifyTransactionOnChain(
  txHash: `0x${string}`,
  expectedContract: `0x${string}`,
  client: PublicClient = publicClient(),
): Promise<VerificationResult> {
  await assertBscTestnet(client);
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  const transaction = await client.getTransaction({ hash: txHash });
  const reasons: string[] = [];
  const contractMatch = transaction.to?.toLowerCase() === expectedContract.toLowerCase();
  if (!contractMatch) reasons.push('Transaction target does not match the expected contract');
  if (receipt.status !== 'success') reasons.push('Transaction reverted');
  return {
    verified: receipt.status === 'success' && contractMatch,
    chainId: 97,
    txHash,
    blockNumber: receipt.blockNumber,
    receiptStatus: receipt.status,
    contractMatch,
    reasons,
  };
}

export { CONTRACTS, decodeEventLog };

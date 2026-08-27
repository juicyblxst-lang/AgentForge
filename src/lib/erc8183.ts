import { createPublicClient, createWalletClient, custom, http, keccak256, stringToHex, type Address, type Hash } from 'viem';
import { bscTestnet } from 'viem/chains';
import { CONTRACTS } from './chain';

const commerceAbi = [
  { type: 'function', name: 'createJob', stateMutability: 'nonpayable', inputs: [{ name:'provider',type:'address' },{ name:'evaluator',type:'address' },{ name:'expiredAt',type:'uint256' },{ name:'description',type:'string' },{ name:'hook',type:'address' }], outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{name:'jobId',type:'uint256'},{name:'expectedBudget',type:'uint256'},{name:'optParams',type:'bytes'}], outputs: [] },
  { type: 'function', name: 'paymentToken', stateMutability: 'view', inputs: [], outputs: [{type:'address'}] },
  { type: 'function', name: 'getJob', stateMutability: 'view', inputs: [{name:'jobId',type:'uint256'}], outputs: [{name:'job',type:'tuple',components:[{name:'id',type:'uint256'},{name:'client',type:'address'},{name:'provider',type:'address'},{name:'evaluator',type:'address'},{name:'description',type:'string'},{name:'budget',type:'uint256'},{name:'expiredAt',type:'uint256'},{name:'status',type:'uint8'},{name:'hook',type:'address'},{name:'submittedAt',type:'uint256'},{name:'deliverable',type:'bytes32'}]}] },
] as const;
const routerAbi = [
  { type:'function', name:'registerJob', stateMutability:'nonpayable', inputs:[{name:'jobId',type:'uint256'},{name:'policy',type:'address'}], outputs:[] },
  { type:'function', name:'settle', stateMutability:'nonpayable', inputs:[{name:'jobId',type:'uint256'},{name:'evidence',type:'bytes'}], outputs:[] },
  { type:'function', name:'policyWhitelist', stateMutability:'view', inputs:[{name:'policy',type:'address'}], outputs:[{type:'bool'}] },
] as const;
const policyAbi = [{ type:'function', name:'disputeWindow', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] }] as const;
const erc20Abi = [
  { type:'function', name:'approve', stateMutability:'nonpayable', inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}], outputs:[{type:'bool'}] },
  { type:'function', name:'allowance', stateMutability:'view', inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}], outputs:[{type:'uint256'}] },
] as const;

export const PAYMENT_TOKEN = '0xc70B8741B8B07A6d61E54fd4B20f22fa648e5565' as Address;
export const publicBscClient = createPublicClient({ chain:bscTestnet, transport:http(import.meta.env.VITE_BSC_TESTNET_RPC_URL || undefined) });

export async function connectWallet() {
  const provider = (window as any).ethereum;
  if (!provider) throw new Error('Install an EVM wallet such as MetaMask.');
  const wallet = createWalletClient({ chain:bscTestnet, transport:custom(provider) });
  const [account] = await wallet.requestAddresses();
  const chainId = await wallet.getChainId();
  if (chainId !== 97) await wallet.switchChain({ id:97 });
  return { wallet, account: account as Address };
}

async function tx(wallet:any, request:any): Promise<Hash> {
  const hash = await wallet.writeContract(request);
  await publicBscClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function createAndFundJob(account:Address, wallet:any, provider:Address, budget:bigint, description:string) {
  const disputeWindow = await publicBscClient.readContract({address:CONTRACTS.optimisticPolicy,abi:policyAbi,functionName:'disputeWindow'});
  const now = BigInt(Math.floor(Date.now()/1000));
  const expiredAt = now + disputeWindow + 600n;
  const createHash = await tx(wallet, { account, address:CONTRACTS.agenticCommerce, abi:commerceAbi, functionName:'createJob', args:[provider,CONTRACTS.evaluatorRouter,expiredAt,description,CONTRACTS.evaluatorRouter] });
  const receipt = await publicBscClient.getTransactionReceipt({ hash:createHash });
  const log = receipt.logs.find(l => l.address.toLowerCase() === CONTRACTS.agenticCommerce.toLowerCase() && l.topics.length > 1);
  const jobId = log?.topics?.[1];
  if (!jobId) throw new Error('JobCreated event did not contain a jobId');
  const id = BigInt(jobId);
  const registered = await publicBscClient.readContract({ address:CONTRACTS.evaluatorRouter, abi:routerAbi, functionName:'policyWhitelist', args:[CONTRACTS.optimisticPolicy] });
  if (!registered) throw new Error('OptimisticPolicy is not whitelisted by the EvaluatorRouter');
  await tx(wallet,{account,address:CONTRACTS.evaluatorRouter,abi:routerAbi,functionName:'registerJob',args:[id,CONTRACTS.optimisticPolicy]});
  const allowance = await publicBscClient.readContract({address:PAYMENT_TOKEN,abi:erc20Abi,functionName:'allowance',args:[account,CONTRACTS.agenticCommerce]});
  if (allowance < budget) await tx(wallet,{account,address:PAYMENT_TOKEN,abi:erc20Abi,functionName:'approve',args:[CONTRACTS.agenticCommerce,budget]});
  const fundHash = await tx(wallet,{account,address:CONTRACTS.agenticCommerce,abi:commerceAbi,functionName:'fund',args:[id,budget,'0x']});
  return { jobId:id, createHash, fundHash };
}

export async function settleJob(account:Address, wallet:any, jobId:bigint) {
  const hash = await tx(wallet,{account,address:CONTRACTS.evaluatorRouter,abi:routerAbi,functionName:'settle',args:[jobId,'0x']});
  return hash;
}

export function deliverableHash(text:string): `0x${string}` { return keccak256(stringToHex(text)); }

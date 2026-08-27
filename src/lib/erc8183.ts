import { createPublicClient, createWalletClient, custom, http, decodeEventLog, keccak256, stringToHex, type Address, type Hash } from 'viem';
import { bscTestnet } from 'viem/chains';
import { CONTRACTS } from './chain';

const commerceAbi = [
  { type: 'function', name: 'createJob', stateMutability: 'nonpayable', inputs: [{ name:'provider',type:'address' },{ name:'evaluator',type:'address' },{ name:'expiredAt',type:'uint256' },{ name:'description',type:'string' },{ name:'hook',type:'address' }], outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'nonpayable', inputs: [{name:'jobId',type:'uint256'},{name:'expectedBudget',type:'uint256'},{name:'optParams',type:'bytes'}], outputs: [] },
  { type: 'function', name: 'paymentToken', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
  { type: 'function', name: 'getJob', stateMutability:'view', inputs:[{name:'jobId',type:'uint256'}], outputs:[{name:'job',type:'tuple',components:[{name:'id',type:'uint256'},{name:'client',type:'address'},{name:'provider',type:'address'},{name:'evaluator',type:'address'},{name:'description',type:'string'},{name:'budget',type:'uint256'},{name:'expiredAt',type:'uint256'},{name:'status',type:'uint8'},{name:'hook',type:'address'},{name:'submittedAt',type:'uint256'},{name:'deliverable',type:'bytes32'}]}] },
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
  { type:'function', name:'balanceOf', stateMutability:'view', inputs:[{name:'owner',type:'address'}], outputs:[{type:'uint256'}] },
] as const;
const jobCreatedEvent = { type:'event', name:'JobCreated', inputs:[
  {indexed:true,name:'jobId',type:'uint256'}, {indexed:true,name:'client',type:'address'}, {indexed:true,name:'provider',type:'address'},
  {indexed:false,name:'evaluator',type:'address'}, {indexed:false,name:'expiredAt',type:'uint256'}
] } as const;

export const publicBscClient = createPublicClient({ chain:bscTestnet, transport:http(import.meta.env.VITE_BSC_TESTNET_RPC_URL || undefined) });

export type JobChainStatus = 'OPEN'|'FUNDED'|'SUBMITTED'|'COMPLETED'|'REJECTED'|'EXPIRED'|'UNKNOWN';
export function mapJobStatus(status:number):JobChainStatus {
  return ({0:'OPEN',1:'FUNDED',2:'SUBMITTED',3:'COMPLETED',4:'REJECTED',5:'EXPIRED'} as Record<number,JobChainStatus>)[status] ?? 'UNKNOWN';
}

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
type Eip6963Detail = { info: { name?: string; rdns?: string }; provider: Eip1193Provider };

async function discoverEvmProvider(): Promise<Eip1193Provider | undefined> {
  const win = window as Window & { ethereum?: Eip1193Provider | Eip1193Provider[] };
  const injected = win.ethereum;
  if (injected) {
    const candidates = Array.isArray(injected) ? injected : [injected];
    return candidates.find((candidate) => (candidate as any).isMetaMask) || candidates[0];
  }
  return new Promise((resolve) => {
    const providers: Eip6963Detail[] = [];
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (detail?.provider) providers.push(detail);
    };
    const finish = () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
      const metamask = providers.find((item) => item.info?.rdns === 'io.metamask' || item.info?.name?.toLowerCase() === 'metamask');
      resolve((metamask || providers[0])?.provider);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    window.setTimeout(finish, 300);
  });
}

export async function connectWallet() {
  const provider = await discoverEvmProvider();
  if (!provider) throw new Error('MetaMask was not detected in this browser. Make sure the MetaMask extension is installed and enabled, then refresh AgentForge.');
  const wallet = createWalletClient({ chain:bscTestnet, transport:custom(provider) });
  const [account] = await wallet.requestAddresses();
  const chainId = await wallet.getChainId();
  if (chainId !== 97) await wallet.switchChain({ id:97 });
  return { wallet, account: account as Address };
}

async function tx(wallet:any, request:any): Promise<Hash> {
  const hash = await wallet.writeContract(request);
  const receipt = await publicBscClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return hash;
}

async function readJob(jobId: bigint) { return publicBscClient.readContract({ address:CONTRACTS.agenticCommerce, abi:commerceAbi, functionName:'getJob', args:[jobId] }); }

async function waitForProviderBudget(jobId: bigint, expected: bigint, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await readJob(jobId);
    if (job.status !== 0) throw new Error(`Job ${jobId.toString()} left OPEN state before provider budget was set (status ${job.status})`);
    if (job.budget >= expected) return job.budget;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`Provider did not set the ERC-8183 budget within ${Math.floor(timeoutMs / 1000)} seconds. The provider worker must be running and assigned to this agent.`);
}

export async function createAndFundJob(account:Address, wallet:any, provider:Address, budget:bigint, description:string) {
  if (budget <= 0n) throw new Error('Budget must be greater than zero.');
  const disputeWindow = await publicBscClient.readContract({address:CONTRACTS.optimisticPolicy,abi:policyAbi,functionName:'disputeWindow'});
  const paymentToken = await publicBscClient.readContract({address:CONTRACTS.agenticCommerce,abi:commerceAbi,functionName:'paymentToken'});
  const now = BigInt(Math.floor(Date.now()/1000));
  const expiredAt = now + disputeWindow + 600n;
  const createHash = await tx(wallet, { account, address:CONTRACTS.agenticCommerce, abi:commerceAbi, functionName:'createJob', args:[provider,CONTRACTS.evaluatorRouter,expiredAt,description,CONTRACTS.evaluatorRouter] });
  const receipt = await publicBscClient.getTransactionReceipt({ hash:createHash });
  let jobId: bigint | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACTS.agenticCommerce.toLowerCase()) continue;
    try { const decoded = decodeEventLog({ abi:[jobCreatedEvent], data:log.data, topics:log.topics }); if (decoded.eventName === 'JobCreated') { jobId = decoded.args.jobId; break; } } catch { /* ignore unrelated logs */ }
  }
  if (jobId === undefined) throw new Error('Could not recover jobId from JobCreated event');
  const jobBeforeRegister = await readJob(jobId);
  if (jobBeforeRegister.provider.toLowerCase() !== provider.toLowerCase()) throw new Error('On-chain provider does not match selected ERC-8004 agent wallet');
  const registered = await publicBscClient.readContract({ address:CONTRACTS.evaluatorRouter, abi:routerAbi, functionName:'policyWhitelist', args:[CONTRACTS.optimisticPolicy] });
  if (!registered) throw new Error('OptimisticPolicy is not whitelisted by the EvaluatorRouter');
  await tx(wallet,{account,address:CONTRACTS.evaluatorRouter,abi:routerAbi,functionName:'registerJob',args:[jobId,CONTRACTS.optimisticPolicy]});
  await waitForProviderBudget(jobId, budget);
  const allowance = await publicBscClient.readContract({address:paymentToken,abi:erc20Abi,functionName:'allowance',args:[account,CONTRACTS.agenticCommerce]});
  if (allowance < budget) await tx(wallet,{account,address:paymentToken,abi:erc20Abi,functionName:'approve',args:[CONTRACTS.agenticCommerce,budget]});
  const balance = await publicBscClient.readContract({address:paymentToken,abi:erc20Abi,functionName:'balanceOf',args:[account]});
  if (balance < budget) throw new Error(`Insufficient payment-token balance. Need ${budget.toString()} base units.`);
  const fundHash = await tx(wallet,{account,address:CONTRACTS.agenticCommerce,abi:commerceAbi,functionName:'fund',args:[jobId,budget,'0x']});
  const fundedJob = await readJob(jobId);
  if (fundedJob.status !== 1) throw new Error(`Job ${jobId.toString()} was not confirmed as FUNDED on-chain (status ${fundedJob.status})`);
  return { jobId, createHash, fundHash, paymentToken, expiredAt };
}

export async function getJob(jobId: bigint) { return readJob(jobId); }
export async function waitForJobStatus(jobId:bigint, target:Exclude<JobChainStatus,'OPEN'|'UNKNOWN'>, timeoutMs=300_000, onUpdate?:(status:JobChainStatus)=>void) {
  const started=Date.now();
  while(Date.now()-started<timeoutMs){ const job=await readJob(jobId); const status=mapJobStatus(Number(job.status)); onUpdate?.(status); if(status===target) return job; if(['REJECTED','EXPIRED','UNKNOWN'].includes(status)) throw new Error(`Job ${jobId.toString()} reached terminal status ${status}`); await new Promise(resolve=>setTimeout(resolve,5000)); }
  throw new Error(`Timed out waiting for job ${jobId.toString()} to reach ${target}.`);
}
export async function settleJob(account:Address, wallet:any, jobId:bigint) { return tx(wallet,{account,address:CONTRACTS.evaluatorRouter,abi:routerAbi,functionName:'settle',args:[jobId,'0x']}); }
export function deliverableHash(text:string): `0x${string}` { return keccak256(stringToHex(text)); }

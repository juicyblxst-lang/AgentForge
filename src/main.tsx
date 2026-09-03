import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { createWalletClient, custom } from 'viem';
import { bscTestnet } from 'viem/chains';
import { discoverBscAgents, type MarketplaceAgent, type MarketplaceCategory } from './lib/discovery';
import { getAgentIdentity, verifyAgentCapabilities, type CapabilityVerification } from './lib/erc8004';
import { connectWallet, createAndFundJob, getJob, waitForJobStatus } from './lib/erc8183';
import { listStoredExecutions, saveStoredExecution, syncExecution, type StoredExecution } from './lib/executionStore';
import { loadRemoteExecutions, persistRemoteExecution } from './lib/remoteExecutionStore';
import { verifyTransactionOnChain } from './lib/verification';
import { CONTRACTS } from './lib/chain';
import { AgentCard } from './components/AgentCard';

const categories: Array<'All agents' | MarketplaceCategory> = ['All agents', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring'];
const DEMO_BUDGET = 10_000_000_000_000_000n;

type ConnectedWallet = { wallet: ReturnType<typeof createWalletClient>; account: `0x${string}` };

type ProviderExecution = {
  txHash?: string;
  route?: { agentId?: string; chainId?: number; source?: string };
  service?: { serviceName?: string; endpoint?: string; protocol?: string };
  result?: { text?: string; response?: unknown; request?: unknown; receivedAt?: string; protocol?: string; serviceName?: string; endpoint?: string };
};

function App() {
  const [category,setCategory]=React.useState<'All agents' | MarketplaceCategory>('All agents'); const [agents,setAgents]=React.useState<MarketplaceAgent[]>([]);
  const [selected,setSelected]=React.useState<MarketplaceAgent|null>(null); const [wallet,setWallet]=React.useState<ConnectedWallet|null>(null);
  const [identity,setIdentity]=React.useState<any>(null); const [capability,setCapability]=React.useState<CapabilityVerification|null>(null); const [status,setStatus]=React.useState('Loading Agent0…'); const [busy,setBusy]=React.useState(false);
  const [result,setResult]=React.useState<any>(null); const [history,setHistory]=React.useState<StoredExecution[]>([]); const [providerAddress,setProviderAddress]=React.useState<string|null>(null);

  const hydrateHistory=React.useCallback(async(account:string)=>{try{const remote=await loadRemoteExecutions(account);remote.forEach(saveStoredExecution);setHistory(listStoredExecutions())}catch{setHistory(listStoredExecutions())}},[]);
  const load=React.useCallback(async()=>{try{setStatus('Discovering real BSC Testnet agents…');const [discovered,provider]=await Promise.all([discoverBscAgents(),fetch('/api/provider').then(r=>r.json())]);setAgents(discovered);setProviderAddress(provider.address||null);setStatus(provider.address?'Live Agent0 discovery · provider ready':'Live Agent0 discovery · provider not configured')}catch(e){setStatus(e instanceof Error?e.message:'Discovery failed')}},[]);

  React.useEffect(()=>{void load();setHistory(listStoredExecutions());let cancelled=false;async function hydrateConnectedWallet(){try{const ethereum=(window as any).ethereum;if(!ethereum)return;const accounts=await ethereum.request({method:'eth_accounts'}) as string[];if(cancelled||!accounts?.[0])return;const walletClient=createWalletClient({chain:bscTestnet,transport:custom(ethereum)});const chainId=await walletClient.getChainId();if(chainId!==97)await walletClient.switchChain({id:97});const account=accounts[0] as `0x${string}`;setWallet({wallet:walletClient,account});await hydrateHistory(account)}catch{}}void hydrateConnectedWallet();return()=>{cancelled=true}},[load,hydrateHistory]);
  const connect=async()=>{try{const connected=await connectWallet();setWallet(connected);await hydrateHistory(connected.account)}catch(e){setStatus(e instanceof Error?e.message:'Wallet connection failed')}};

  const openAgent=async(agent:MarketplaceAgent)=>{setSelected(agent);setIdentity(null);setCapability(null);setResult(null);setStatus('Verifying agent…');try{const nextIdentity=await getAgentIdentity(BigInt(agent.agentId));const nextCapability=await verifyAgentCapabilities(nextIdentity);setIdentity(nextIdentity);setCapability(nextCapability);setStatus(nextCapability.verified?'Identity + capability verified':`Capability verification failed: ${nextCapability.reason||'No declared capabilities were found.'}`)}catch(e){setStatus(e instanceof Error?e.message:'Agent verification failed')}};

  async function execute(){
    if(!selected||!wallet||!providerAddress||!selected.agentWallet)return;
    let stored:StoredExecution|undefined;
    try{
      setBusy(true);setResult(null);setStatus(`Creating ERC-8183 job for ${selected.name} through AgentForge provider…`);
      const executionProvider=providerAddress as `0x${string}`;
      const task=`Hire ${selected.name} (ERC-8004 agent ${selected.agentId}): ${selected.description||'BNB Chain agent execution'}`;
      const value=await createAndFundJob(wallet.account,wallet.wallet,executionProvider,DEMO_BUDGET,task);
      const now=new Date().toISOString();
      stored={id:value.jobId.toString(),agentId:selected.agentId,agentName:selected.name,wallet:wallet.account,chainId:97,protocol:'ERC-8183',jobId:value.jobId.toString(),createHash:value.createHash,fundHash:value.fundHash,status:'FUNDED',createdAt:now,updatedAt:now};
      saveStoredExecution(stored);setHistory(listStoredExecutions());

      setStatus(`Job #${value.jobId} funded. Invoking AgentForge provider with ERC-8004 agent #${selected.agentId}…`);
      const providerResponse=await fetch('/api/provider-execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId:Number(value.jobId),agentId:Number(selected.agentId)})});
      const providerBody=await providerResponse.json().catch(()=>({}));
      if(!providerResponse.ok) throw new Error(providerBody?.error||`Provider execution failed (${providerResponse.status})`);
      const providerExecution=providerBody as ProviderExecution;
      const agentResult=providerExecution.result||null;
      const deliverable=agentResult?JSON.stringify(agentResult):undefined;
      const submittedAt=new Date().toISOString();
      stored={...stored,status:'SUBMITTED',updatedAt:submittedAt,submittedAt,deliverable};
      await syncExecution(stored);setHistory(listStoredExecutions());
      setResult({...value,verified:false,providerExecution,agentResult});

      const job=await waitForJobStatus(value.jobId,'SUBMITTED',300_000,(chainStatus)=>{if(chainStatus==='FUNDED')setStatus(`Job #${value.jobId} funded. AgentForge provider is executing ${selected.name}…`)});
      setStatus(`Provider submitted job #${value.jobId}. Verifying on-chain state…`);
      const [createVerification,fundVerification]=await Promise.all([verifyTransactionOnChain(value.createHash,CONTRACTS.agenticCommerce),verifyTransactionOnChain(value.fundHash,CONTRACTS.agenticCommerce)]);
      const verified=createVerification.verified&&fundVerification.verified&&job.client.toLowerCase()===wallet.account.toLowerCase()&&job.provider.toLowerCase()===executionProvider.toLowerCase()&&job.status===2;
      stored={...stored,status:verified?'VERIFIED':'FAILED',updatedAt:new Date().toISOString()};await syncExecution(stored);setHistory(listStoredExecutions());setStatus(verified?`Job ${value.jobId} is VERIFIED on BSC Testnet · persisted`:'On-chain verification failed · persisted');setResult({...value,verified,createVerification,fundVerification,job,providerExecution,agentResult});
    }catch(e){if(stored){const failed:StoredExecution={...stored,status:'FAILED',updatedAt:new Date().toISOString()};saveStoredExecution(failed);setHistory(listStoredExecutions());try{await persistRemoteExecution(failed)}catch{}}setStatus(e instanceof Error?e.message:'Execution failed')}finally{setBusy(false)}
  }

  const visible=agents.filter(a=>category==='All agents'||a.categories.includes(category));
  const selectedWallet=(identity?.agentWallet||selected?.agentWallet||'') as string;
  const isAgentForgeProvider=Boolean(providerAddress);
  const canExecute=Boolean(identity&&capability?.verified&&providerAddress&&selectedWallet&&wallet);
  const categoryEvidence=selected?.categoryEvidence?.[category as MarketplaceCategory]||[];

  return <main className="shell"><header className="nav"><div className="brand">AGENTFORGE</div><div className="network"><span/> BSC Testnet · 97</div><button className="wallet" onClick={connect}>{wallet?`${wallet.account.slice(0,6)}…${wallet.account.slice(-4)}`:'Connect wallet'}</button></header>
    <section className="hero"><p className="eyebrow">ERC-8004 AGENT MARKETPLACE</p><h1>Find an agent.<br/>Verify it. Execute.</h1><p className="lede">Real Agent0 discovery, on-chain ERC-8004 identity verification and ERC-8183 commerce on BSC Testnet.</p></section>
    <section className="market"><div className="toolbar"><div className="categories">{categories.map(item=><button key={item} className={category===item?'active':''} onClick={()=>setCategory(item)}>{item}</button>)}</div><button className="refresh" onClick={()=>void load()}>Refresh</button></div><p className="status">{status}</p>
      {selected?<section className="detail"><button className="back" onClick={()=>setSelected(null)}>← Marketplace</button><div className="detail-head"><div><p className="eyebrow">AGENT DETAIL</p><h2>{selected.name}</h2><p>{selected.description||'ERC-8004 registered agent on BSC Testnet.'}</p></div><span className="verified">{capability?.verified?'✓ Identity + capability verified':identity?'✓ Identity verified':'Verifying…'}</span></div>
        <div className="facts"><div><small>AGENT ID</small><strong>{selected.agentId}</strong></div><div><small>OWNER</small><strong>{identity?.owner||selected.owner||'—'}</strong></div><div><small>AGENT WALLET</small><strong>{selectedWallet||'—'}</strong></div><div><small>CAPABILITIES</small><strong>{(capability?.capabilities.length?capability.capabilities:selected.capabilities).join(', ')||'None declared'}</strong></div></div>
        {selected.categories.length>0&&<div className="provider-state"><strong>CATEGORIES:</strong> {selected.categories.join(' · ')}</div>}
        {categoryEvidence.length>0&&<div className="provider-state"><strong>{category} evidence:</strong> {categoryEvidence.join(', ')}</div>}
        <div className="permission-panel"><p className="eyebrow">AUTHORIZATION</p><h2>Review execution</h2><p>{isAgentForgeProvider?'This agent can be hired through AgentForge. AgentForge will create and fund the ERC-8183 job using the configured AgentForge execution provider, while preserving this agent as the selected service.':'AgentForge execution provider is not configured, so no transaction will be attempted.'}</p><div className="facts"><div><small>NETWORK</small><strong>BSC Testnet (97)</strong></div><div><small>PROTOCOL</small><strong>ERC-8183</strong></div><div><small>MAX PAYMENT</small><strong>0.01 U</strong></div></div>{isAgentForgeProvider&&<p className="provider-state">✓ AgentForge execution provider available · ERC-8183 execution enabled</p>}{isAgentForgeProvider&&providerAddress&&selectedWallet&&selectedWallet.toLowerCase()!==providerAddress.toLowerCase()&&<p className="provider-state">Selected agent wallet: {selectedWallet.slice(0,6)}…{selectedWallet.slice(-4)} · execution provider: {providerAddress.slice(0,6)}…{providerAddress.slice(-4)}</p>}<button className="authorize" disabled={busy||!canExecute} onClick={()=>void execute()}>{busy?'Executing…':!providerAddress?'Provider not configured':!capability?.verified?'Capability verification required':!selectedWallet?'Agent wallet unavailable':!wallet?'Connect wallet to execute':'Hire & execute via AgentForge'}</button></div>
        {result&&<div className="result"><p className="eyebrow">ON-CHAIN RESULT</p><strong>Job #{String(result.jobId)} · {result.verified?'VERIFIED':'SUBMITTED'}</strong><p>Create: {result.createHash}</p><p>Fund: {result.fundHash}</p><p>Provider submission status: {result.job?.status===2?'SUBMITTED':result.providerExecution?.status||'—'}</p><p>Execution provider: {result.job?.provider||providerAddress||'—'}</p>{result.providerExecution?.route&&<p>ERC-8004 route: agent #{result.providerExecution.route.agentId} · chain {result.providerExecution.route.chainId}</p>}{result.providerExecution?.service&&<p>Resolved provider service: {result.providerExecution.service.serviceName||'ERC-8183'} · {result.providerExecution.service.protocol||'custom'}</p>}{result.agentResult?.text&&<><p className="eyebrow">AGENT OUTPUT</p><pre>{result.agentResult.text}</pre></>}</div>}
      </section>:<><div className="agents">{visible.length?visible.map(agent=><AgentCard key={agent.id} agent={agent} onOpen={()=>void openAgent(agent)}/>):<div className="empty-state"><div className="orb">A</div><p className="eyebrow">{status}</p><h2>No agents loaded</h2><p>{category==='All agents'?'Set the Agent0 Graph API key in the environment, then refresh.':`No discovered agents are currently classified as ${category}.`}</p></div>}</div>{history.length>0&&<div className="history"><p className="eyebrow">EXECUTION HISTORY · SURVIVES REFRESH</p>{history.slice(0,5).map(x=><div className="history-row" key={x.id}><strong>#{x.jobId} · {x.agentName}</strong><span>{x.status}</span><code>{x.fundHash.slice(0,12)}…</code></div>)}</div>}</>}
    </section></main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

import type { MarketplaceAgent } from '../lib/discovery';

export function AgentCard({ agent, onOpen }: { agent: MarketplaceAgent; onOpen: () => void }) {
  return <article className="agent-card">
    <div className="agent-icon">{agent.name.slice(0, 1).toUpperCase()}</div>
    <div className="agent-card-body">
      <div className="agent-title-row"><h3>{agent.name}</h3><span className="verified-dot">ERC-8004</span></div>
      <p>{agent.description || 'On-chain agent on BSC Testnet.'}</p>
      <div className="chips">{agent.capabilities.slice(0, 4).map(c => <span key={c}>{c}</span>)}</div>
      <button className="text-button" onClick={onOpen}>Open agent →</button>
    </div>
  </article>;
}

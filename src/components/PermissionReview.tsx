import type { Capability } from '../lib/types';

export function PermissionReview({ agentName, wallet, capability, budget, onAuthorize, busy = false }: { agentName: string; wallet: string; capability: Capability; budget: string; onAuthorize: () => void; busy?: boolean }) {
  return <section className="permission-panel">
    <p className="eyebrow">AUTHORIZATION</p>
    <h2>Review permissions</h2>
    <div className="permission-grid">
      <div><small>AGENT</small><strong>{agentName}</strong></div>
      <div><small>NETWORK</small><strong>BNB Smart Chain Testnet</strong></div>
      <div><small>PROTOCOL</small><strong>ERC-8183</strong></div>
      <div><small>WALLET</small><strong>{wallet}</strong></div>
      <div><small>CAPABILITY</small><strong>{capability.name}</strong></div>
      <div><small>MAXIMUM PAYMENT</small><strong>{budget} BNB</strong></div>
    </div>
    <button className="authorize" disabled={busy} onClick={onAuthorize}>{busy ? 'Authorizing…' : 'Authorize execution'}</button>
  </section>;
}

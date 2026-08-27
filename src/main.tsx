import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const categories = ['All agents', 'Research', 'Trading', 'DeFi', 'Commerce'];

function App() {
  const [category, setCategory] = React.useState('All agents');
  const [connected, setConnected] = React.useState(false);

  return (
    <main className="shell">
      <header className="nav">
        <div className="brand">AGENTFORGE</div>
        <div className="network"><span /> BSC Testnet</div>
        <button className="wallet" onClick={() => setConnected(true)}>
          {connected ? '0x••••••' : 'Connect wallet'}
        </button>
      </header>

      <section className="hero">
        <p className="eyebrow">ERC-8004 AGENT MARKETPLACE</p>
        <h1>Find an agent.<br />Verify it. Execute.</h1>
        <p className="lede">Discover real agents on BNB Chain, verify their on-chain identity and capabilities, then authorize execution from your wallet.</p>
      </section>

      <section className="market">
        <div className="categories">
          {categories.map((item) => (
            <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>
          ))}
        </div>

        <div className="empty-state">
          <div className="orb">A</div>
          <p className="eyebrow">LIVE DISCOVERY</p>
          <h2>{category === 'All agents' ? 'Connect discovery to see real agents' : `Explore ${category}`}</h2>
          <p>The marketplace shell is ready. The next integration wires Agent0 discovery and ERC-8004 verification into these cards.</p>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);

# AgentForge

AgentForge is an ERC-8004 agent marketplace for BNB Smart Chain Testnet. It is designed around one verifiable lifecycle:

**discover → verify identity/capability → connect wallet → review permissions → authorize → execute → verify on-chain → persist → recover after refresh**

## Stack

- React 19 + TypeScript + Vite
- viem for EVM/BSC interaction
- Agent0 / GraphQL for agent discovery
- ERC-8004 for agent identity
- ERC-8183 for agentic commerce execution
- Browser EVM wallet for user authorization

## Network

BSC Testnet / chain ID `97`.

## Environment

Copy `.env.example` to `.env.local` and provide the Agent0 Graph endpoint when available. Never commit wallet private keys or API secrets.

## Development

```bash
npm install
npm run dev
npm run build
```

## Execution contract

The app treats a wallet-returned transaction hash as **submitted**, not successful. A transaction becomes **VERIFIED** only after an independent BSC receipt/state check confirms the expected chain, target contract and successful receipt. Production persistence will be backed by a server database; local persistence currently provides the browser recovery contract while the external credentials are being provisioned.

# AgentForge — PancakeSwap Challenge Evidence

## What the challenge requires

The PancakeSwap partner challenge asks for a real benefit to PancakeSwap traders or liquidity providers. The official examples include smarter liquidity management, better-yield discovery, market research that improves pool liquidity, and safe automated swaps without putting user funds at risk.

Source: https://www.bnbchain.org/en/hackathons/smart-money-era

## Existing AgentForge proof

AgentForge already has a real PancakeSwap-oriented marketplace agent surface and a proven ERC-8183 hiring rail. Job #737 is preserved as the canonical execution proof:

- Agent: Pancake Ranger (ERC-8004 ID 2011)
- Job: 737
- Network: BSC Testnet (97)
- Result: VERIFIED
- Provider: AgentForge execution provider `0x46cBFBdDfeDDDc783D1f58976F91a488710695dc`
- Create tx: `0x56e64581dfefb7fd3ff625a45d50ecc2beb0ad293a22496a7cd912c393af8aa5`
- Fund tx: `0xd9cfb637f129f0f7ae0a91a0bee0730bd976c5fa1fb94279f9a9b0d1bf1c0532`

This proves the marketplace can hire an agent through ERC-8183. It does **not** by itself prove the PancakeSwap-specific outcome, so the remaining evidence must connect the agent's work to a concrete PancakeSwap trader/LP benefit.

## Strongest demonstration to collect

Use a real concentrated-liquidity position and capture:

1. Position/pool address and chain.
2. Current price and current tick.
3. Existing lower/upper ticks and whether the position is in range.
4. Recent fee-growth and volume evidence used by the agent.
5. Agent's proposed replacement range and the rule/evidence that produced it.
6. Expected effect on fee-earning exposure or out-of-range risk.
7. If execution is authorized, the transaction hash and resulting position state.
8. A before/after screenshot or machine-readable position snapshot.

## Safety boundary

The evidence run should use a bounded authorization and should never require uncontrolled user funds. Testnet execution is acceptable for the hackathon evidence; if a mainnet demonstration is used, use only funds the owner explicitly intends to risk.

## Evidence record

Save each completed run as `docs/pancakeswap-evidence/<date>-<agent-id>.json` with:

```json
{
  "agentId": "2011",
  "agentName": "Pancake Ranger",
  "chainId": 97,
  "pool": "",
  "position": "",
  "before": {},
  "agentAnalysis": "",
  "proposedAction": {},
  "execution": {
    "attempted": false,
    "txHash": ""
  },
  "after": {},
  "benefit": "",
  "sources": []
}
```

Do not fill this with estimated or invented results. The partner submission should contain the actual observed PancakeSwap state and transaction evidence.

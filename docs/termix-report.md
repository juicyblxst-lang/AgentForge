# AgentForge — TermiX Agent Advantage Report

## Status

**Evidence collection in progress.** This report intentionally contains no fabricated benchmark numbers. TermiX requires at least three real tasks run both ways (agent hired through the marketplace vs manual), with time, cost, output quality, and actual outputs attached; at least one task must be trading, stock/equities, or security.

The BNB Chain Build the Era rules explicitly require those three paired real tasks for eligibility. See the official hackathon page: https://www.bnbchain.org/en/hackathons/smart-money-era

## Benchmark protocol

For every task:

1. Freeze the task wording and success criteria before either run.
2. Run the task through an agent selected from AgentForge.
3. Record start/end timestamps, marketplace agent ID, job ID (when ERC-8183 is used), transaction hashes, quoted price, and the complete returned output.
4. Run the identical task manually using the same public inputs and the same cutoff time.
5. Record manual start/end timestamps, direct cost, and complete output.
6. Score both outputs against the same rubric before looking at the timing/cost result.
7. Save raw evidence under `docs/termix-evidence/` and reference it from this report.

## Task matrix

| # | Required area | Agent | Agent run | Manual run | Time | Cost | Output quality | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | Trading / yield | **TBD — select a live BSC agent from AgentForge** | PENDING | PENDING | PENDING | PENDING | PENDING | `docs/termix-evidence/task-1.*` |
| 2 | Security / lending risk | **TBD — select a live BSC agent from AgentForge** | PENDING | PENDING | PENDING | PENDING | PENDING | `docs/termix-evidence/task-2.*` |
| 3 | Monitoring / market or position event | **TBD — select a live BSC agent from AgentForge** | PENDING | PENDING | PENDING | PENDING | PENDING | `docs/termix-evidence/task-3.*` |

## Quality rubric

Score each output from 0–100 using the same criteria:

- **Correctness (40):** factual accuracy against the frozen inputs.
- **Coverage (25):** all requested fields/findings are present.
- **Actionability (20):** a user can make the intended decision from the result.
- **Evidence (15):** claims include usable source/transaction references.

## Timing and cost

Use wall-clock elapsed time from task submission to complete usable output. Do not count setup work that would also be required for the manual baseline. Report direct execution/payment costs separately from gas costs and clearly state the unit.

## Raw-output requirement

Do not summarize away the evidence. Attach the complete agent response and the complete manual result for each task. Screenshots may supplement, but must not replace machine-readable output where available.

## Submission rule

This document is not considered complete until all three rows have actual measurements and all six paired output files exist. The existing ERC-8183 Job #737 proof demonstrates AgentForge's hiring/execution rail, but it is **not** itself a TermiX benchmark because it does not establish the required agent-vs-manual task advantage.

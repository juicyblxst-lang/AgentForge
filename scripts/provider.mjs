import { EVMWalletProvider, ERC8183Client, loadEnv } from "@bnbagent/sdk";
import { ERC8183JobOps, fundedJobWatcher } from "@bnbagent/sdk/erc8183";
import { LocalStorageProvider } from "@bnbagent/sdk/storage";
import { createPublicClient, http, parseAbiItem } from "viem";
import { bscTestnet } from "viem/chains";

loadEnv();

for (const name of ["WALLET_PASSWORD", "PRIVATE_KEY"]) {
  if (!process.env[name]) throw new Error(`${name} is required for the ERC-8183 provider worker`);
}

const network = process.env.NETWORK || "bsc-testnet";
if (network !== "bsc-testnet") throw new Error("AgentForge provider worker currently supports bsc-testnet only");

const servicePrice = BigInt(process.env.ERC8183_SERVICE_PRICE || "10000000000000000"); // 0.01 U
const agentUrl = process.env.ERC8183_AGENT_URL;
if (!agentUrl) throw new Error("ERC8183_AGENT_URL is required for the provider worker");

const AGENTIC_COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de";
const wallet = new EVMWalletProvider({ password: process.env.WALLET_PASSWORD, privateKey: process.env.PRIVATE_KEY });
const client = await ERC8183Client.create({ walletProvider: wallet, network });
const jobOps = await ERC8183JobOps.create({
  walletProvider: wallet,
  network,
  storageProvider: new LocalStorageProvider(process.env.STORAGE_LOCAL_PATH || ".agent-data"),
  servicePrice,
  agentUrl,
  allowUnsignedJobs: true,
});

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.RPC_URL || undefined) });
const jobCreatedEvent = parseAbiItem(
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt)",
);
const budgeted = new Set();
let lastScannedBlock = null;

async function setBudgetsForOpenJobs() {
  const latest = await publicClient.getBlockNumber();
  const fromBlock = lastScannedBlock === null ? (latest > 5000n ? latest - 5000n : 0n) : lastScannedBlock + 1n;
  if (fromBlock > latest) return;

  const logs = await publicClient.getLogs({ address: AGENTIC_COMMERCE, event: jobCreatedEvent, fromBlock, toBlock: latest });
  lastScannedBlock = latest;

  for (const log of logs) {
    const jobId = log.args.jobId;
    const provider = log.args.provider;
    if (jobId === undefined || !provider || provider.toLowerCase() !== jobOps.agentAddress.toLowerCase()) continue;
    const key = jobId.toString();
    if (budgeted.has(key)) continue;

    const job = await client.getJob(jobId);
    if (job.status !== 0) { budgeted.add(key); continue; }

    try {
      const result = await client.setBudget(jobId, servicePrice);
      console.log(`[provider] set budget for #${key}: ${servicePrice} tx=${result.transactionHash}`);
      budgeted.add(key);
    } catch (error) {
      console.error(`[provider] setBudget failed for #${key}:`, error instanceof Error ? error.message : error);
    }
  }
}

console.log(`[provider] address=${jobOps.agentAddress}`);
console.log(`[provider] network=${network}`);
console.log(`[provider] servicePrice=${servicePrice}`);
console.log("[provider] waiting for OPEN jobs to set budget, then FUNDED jobs to execute");

setInterval(() => void setBudgetsForOpenJobs().catch((error) => console.error("[provider] budget watcher error:", error instanceof Error ? error.message : error)), Number(process.env.ERC8183_FUNDED_POLL_INTERVAL || 30) * 1000);
await setBudgetsForOpenJobs();

await fundedJobWatcher(
  jobOps,
  async (job) => {
    const jobId = Number(job.jobId);
    const description = String(job.description || "");
    console.log(`[provider] funded job #${jobId}: ${description}`);

    const deliverable = JSON.stringify({ status: "completed", jobId, provider: jobOps.agentAddress, description, processedAt: new Date().toISOString() });
    const result = await jobOps.submitResult(jobId, deliverable, { agentforge: true, worker: "agentforge-provider-v1" });

    if (!result.success) {
      console.error(`[provider] submit failed for #${jobId}: ${result.error}`);
      return { retry: result.retryable === true };
    }
    console.log(`[provider] submitted #${jobId}: ${result.txHash}`);
  },
  { interval: Number(process.env.ERC8183_FUNDED_POLL_INTERVAL || 30) },
);

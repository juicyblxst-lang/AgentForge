import { createServer } from "node:http";
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

const port = Number(process.env.PORT || 3000);
const AGENTIC_COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de";
const LOG_CHUNK_SIZE = BigInt(process.env.ERC8183_LOG_CHUNK_SIZE || "500");
const MIN_LOG_CHUNK_SIZE = 10n;
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

function isRpcLogLimitError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("LimitExceededRpcError") || text.includes("limit exceeded") || text.includes("Request exceeds defined limit") || error?.cause?.code === -32005;
}

async function getLogsInAdaptiveChunks(fromBlock, toBlock) {
  const logs = [];
  let start = fromBlock;
  let chunkSize = LOG_CHUNK_SIZE;

  while (start <= toBlock) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    try {
      const chunk = await publicClient.getLogs({ address: AGENTIC_COMMERCE, event: jobCreatedEvent, fromBlock: start, toBlock: end });
      logs.push(...chunk);
      start = end + 1n;
      if (chunkSize < LOG_CHUNK_SIZE) chunkSize = chunkSize * 2n > LOG_CHUNK_SIZE ? LOG_CHUNK_SIZE : chunkSize * 2n;
    } catch (error) {
      if (!isRpcLogLimitError(error) || chunkSize <= MIN_LOG_CHUNK_SIZE) throw error;
      chunkSize = chunkSize / 2n;
      console.warn(`[provider] RPC log limit at ${start}-${end}; reducing log chunk size to ${chunkSize}`);
    }
  }
  return logs;
}

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ status: "ok", service: "agentforge-provider", network, chainId: 97, agentWallet: jobOps.agentAddress, servicePrice: servicePrice.toString(), agentUrl }));
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ status: "ok", service: "agentforge-provider" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(port, () => console.log(`[provider] HTTP status server listening on :${port}`));

async function setBudgetsForOpenJobs() {
  const latest = await publicClient.getBlockNumber();
  const initialWindow = BigInt(process.env.ERC8183_INITIAL_SCAN_BLOCKS || "5000");
  const fromBlock = lastScannedBlock === null ? (latest > initialWindow ? latest - initialWindow : 0n) : lastScannedBlock + 1n;
  if (fromBlock > latest) return;

  const logs = await getLogsInAdaptiveChunks(fromBlock, latest);
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
console.log(`[provider] logChunkSize=${LOG_CHUNK_SIZE}`);
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

import { createServer } from "node:http";
import { EVMWalletProvider, ERC8183Client, loadEnv } from "@bnbagent/sdk";
import { ERC8183JobOps } from "@bnbagent/sdk/erc8183";
import { LocalStorageProvider } from "@bnbagent/sdk/storage";

loadEnv();

for (const name of ["WALLET_PASSWORD", "PRIVATE_KEY"]) {
  if (!process.env[name]) throw new Error(`${name} is required for the ERC-8183 provider worker`);
}

const network = process.env.NETWORK || "bsc-testnet";
if (network !== "bsc-testnet") throw new Error("AgentForge provider worker currently supports bsc-testnet only");

const servicePrice = BigInt(process.env.ERC8183_SERVICE_PRICE || "10000000000000000");
const agentUrl = process.env.ERC8183_AGENT_URL;
if (!agentUrl) throw new Error("ERC8183_AGENT_URL is required for the provider worker");

const port = Number(process.env.PORT || 3000);
const pollIntervalMs = Number(process.env.ERC8183_FUNDED_POLL_INTERVAL || 30) * 1000;
const batchSize = Number(process.env.ERC8183_JOB_BATCH_SIZE || 50);

const wallet = new EVMWalletProvider({
  password: process.env.WALLET_PASSWORD,
  privateKey: process.env.PRIVATE_KEY,
});

const client = await ERC8183Client.create({ walletProvider: wallet, network });
const jobOps = await ERC8183JobOps.create({
  walletProvider: wallet,
  network,
  storageProvider: new LocalStorageProvider(process.env.STORAGE_LOCAL_PATH || ".agent-data"),
  servicePrice,
  agentUrl,
  allowUnsignedJobs: true,
});

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify({
      status: "ok",
      service: "agentforge-provider",
      network,
      chainId: 97,
      agentWallet: jobOps.agentAddress,
      servicePrice: servicePrice.toString(),
      agentUrl,
    }));
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify({ status: "ok", service: "agentforge-provider" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(port, () => console.log(`[provider] HTTP status server listening on :${port}`));

const budgeted = new Set();
const funded = new Set();
let lastKnownJobCounter = 0n;
let polling = false;

async function readJobs(jobIds) {
  const jobs = [];
  for (let start = 0; start < jobIds.length; start += batchSize) {
    const batch = jobIds.slice(start, start + batchSize);
    const results = await client.commerce.getJobsBatch(batch);
    for (const job of results) if (job) jobs.push(job);
  }
  return jobs;
}

async function pollJobs() {
  if (polling) return;
  polling = true;

  try {
    const counter = await client.commerce.jobCounter();
    const newJobIds = [];

    for (let id = lastKnownJobCounter; id < counter; id += 1n) {
      newJobIds.push(id);
    }
    lastKnownJobCounter = counter;

    for (const job of await readJobs(newJobIds)) {
      if (job.provider.toLowerCase() !== jobOps.agentAddress.toLowerCase()) continue;
      if (job.status === 0) budgeted.add(job.id.toString());
      if (job.status === 1) funded.add(job.id.toString());
    }

    const tracked = new Set([...budgeted, ...funded]);
    const openIds = new Set();
    const fundedIds = new Set();

    for (const key of tracked) {
      try {
        const job = await client.getJob(BigInt(key));
        if (job.provider.toLowerCase() !== jobOps.agentAddress.toLowerCase()) {
          budgeted.delete(key);
          funded.delete(key);
          continue;
        }
        if (job.status === 0) openIds.add(key);
        else if (job.status === 1) fundedIds.add(key);
        else {
          budgeted.delete(key);
          funded.delete(key);
        }
      } catch (error) {
        console.error(`[provider] getJob(${key}) failed:`, error instanceof Error ? error.message : error);
      }
    }

    for (const key of openIds) {
      if (budgeted.has(key)) continue;
      try {
        const result = await client.setBudget(BigInt(key), servicePrice);
        console.log(`[provider] set budget for #${key}: ${result.txHash || result.transactionHash || "submitted"}`);
        budgeted.add(key);
      } catch (error) {
        console.error(`[provider] setBudget failed for #${key}:`, error instanceof Error ? error.message : error);
      }
    }

    for (const key of fundedIds) {
      try {
        const job = await client.getJob(BigInt(key));
        if (job.status !== 1) {
          funded.delete(key);
          continue;
        }

        console.log(`[provider] funded job #${key}: ${job.description}`);
        const deliverable = JSON.stringify({
          status: "completed",
          jobId: Number(job.id),
          provider: jobOps.agentAddress,
          description: job.description,
          processedAt: new Date().toISOString(),
        });

        const result = await jobOps.submitResult(job.id, deliverable, {
          agentforge: true,
          worker: "agentforge-provider-v1",
        });

        if (!result.success) {
          console.error(`[provider] submit failed for #${key}: ${result.error}`);
          if (result.retryable !== true) funded.delete(key);
          continue;
        }

        console.log(`[provider] submitted #${key}: ${result.txHash}`);
        funded.delete(key);
      } catch (error) {
        console.error(`[provider] funded job #${key} failed:`, error instanceof Error ? error.message : error);
      }
    }
  } finally {
    polling = false;
  }
}

console.log(`[provider] address=${jobOps.agentAddress}`);
console.log(`[provider] network=${network}`);
console.log(`[provider] servicePrice=${servicePrice}`);
console.log(`[provider] polling mode=jobCounter/getJob (no eth_getLogs)`);
console.log(`[provider] batchSize=${batchSize}`);
console.log("[provider] waiting for OPEN jobs to set budget, then FUNDED jobs to execute");

await pollJobs();
setInterval(() => void pollJobs(), pollIntervalMs);

import { EVMWalletProvider, loadEnv } from "@bnbagent/sdk";
import { ERC8183JobOps, fundedJobWatcher } from "@bnbagent/sdk/erc8183";
import { LocalStorageProvider } from "@bnbagent/sdk/storage";

loadEnv();

const required = ["WALLET_PASSWORD", "PRIVATE_KEY"];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`${name} is required for the ERC-8183 provider worker`);
  }
}

const network = process.env.NETWORK || "bsc-testnet";
const servicePrice = BigInt(process.env.ERC8183_SERVICE_PRICE || "1000000000000000000");
const agentUrl = process.env.ERC8183_AGENT_URL;
if (!agentUrl) {
  throw new Error("ERC8183_AGENT_URL is required for the provider worker");
}

const wallet = new EVMWalletProvider({
  password: process.env.WALLET_PASSWORD,
  privateKey: process.env.PRIVATE_KEY,
});

const jobOps = await ERC8183JobOps.create({
  walletProvider: wallet,
  network,
  storageProvider: new LocalStorageProvider(process.env.STORAGE_LOCAL_PATH || ".agent-data"),
  servicePrice,
  agentUrl,
});

console.log(`[provider] address=${jobOps.agentAddress}`);
console.log(`[provider] network=${network}`);
console.log(`[provider] servicePrice=${servicePrice}`);

await fundedJobWatcher(
  jobOps,
  async (job) => {
    const jobId = Number(job.jobId);
    const description = String(job.description || "");
    console.log(`[provider] funded job #${jobId}: ${description}`);

    // Deterministic demo deliverable. Replace this callback with the actual
    // agent workload once the marketplace/provider contract is proven.
    const deliverable = JSON.stringify({
      status: "completed",
      jobId,
      provider: jobOps.agentAddress,
      description,
      processedAt: new Date().toISOString(),
    });

    const result = await jobOps.submitResult(jobId, deliverable, {
      agentforge: true,
      worker: "agentforge-provider-v1",
    });

    if (!result.success) {
      console.error(`[provider] submit failed for #${jobId}: ${result.error}`);
      return { retry: result.retryable === true };
    }

    console.log(`[provider] submitted #${jobId}: ${result.txHash}`);
  },
  { interval: Number(process.env.ERC8183_FUNDED_POLL_INTERVAL || 30) },
);

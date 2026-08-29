import { createServer } from "node:http";
import { EVMWalletProvider, ERC8183Client, loadEnv } from "@bnbagent/sdk";
import { ERC8183JobOps } from "@bnbagent/sdk/erc8183";
import { LocalStorageProvider } from "@bnbagent/sdk/storage";
import { resolveAgentService } from "./erc8004-agent.mjs";

loadEnv();
for (const name of ["WALLET_PASSWORD", "PRIVATE_KEY"]) if (!process.env[name]) throw new Error(`${name} is required for the ERC-8183 provider worker`);
const network = process.env.NETWORK || "bsc-testnet";
if (network !== "bsc-testnet") throw new Error("AgentForge provider worker currently supports bsc-testnet only");
const servicePrice = BigInt(process.env.ERC8183_SERVICE_PRICE || "10000000000000000");
const port = Number(process.env.PORT || 3000);
const pollIntervalMs = Number(process.env.ERC8183_FUNDED_POLL_INTERVAL || 30) * 1000;
const batchSize = Number(process.env.ERC8183_JOB_BATCH_SIZE || 50);
const providerServiceUrl = process.env.PROVIDER_SERVICE_URL || process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${port}`;
const wallet = new EVMWalletProvider({ password: process.env.WALLET_PASSWORD, privateKey: process.env.PRIVATE_KEY });
const client = await ERC8183Client.create({ walletProvider: wallet, network });
const jobOps = await ERC8183JobOps.create({ walletProvider: wallet, network, storageProvider: new LocalStorageProvider(process.env.STORAGE_LOCAL_PATH || ".agent-data"), servicePrice, agentUrl: providerServiceUrl, allowUnsignedJobs: true });

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/status") { res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify({ status: "ok", service: "agentforge-provider", network, chainId: 97, agentWallet: jobOps.agentAddress, servicePrice: servicePrice.toString(), providerServiceUrl, routing: "dynamic-erc8004" })); return; }
  if (req.method === "GET" && req.url === "/health") { res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify({ status: "ok", service: "agentforge-provider" })); return; }
  res.writeHead(404, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Not found" }));
});
httpServer.listen(port, () => console.log(`[provider] HTTP status server listening on :${port}`));

const budgeted = new Set();
const funded = new Set();
const open = new Set();
const terminalFailures = new Set();
const retryState = new Map();
let polling = false;

async function readJobs(jobIds) { const jobs = []; for (let start = 0; start < jobIds.length; start += batchSize) { const results = await client.commerce.getJobsBatch(jobIds.slice(start, start + batchSize)); for (const job of results) if (job) jobs.push(job); } return jobs; }

function extractAgentText(value) {
  const parts = value?.result?.message?.parts || value?.result?.artifacts?.flatMap(a => a.parts || []) || value?.message?.parts || value?.parts;
  if (Array.isArray(parts)) { const text = parts.map(p => p?.text ?? p?.content ?? "").filter(Boolean).join("\n"); if (text) return text; }
  if (typeof value?.result?.text === "string") return value.result.text;
  if (typeof value?.text === "string") return value.text;
  return null;
}

function classifyExecutionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/HTTP\s+(\d{3})/i)?.[1];
  if (status && /^4\d\d$/.test(status)) return { terminal: true, message };
  return { terminal: false, message };
}
function retryAllowed(key) {
  const state = retryState.get(key) || { attempts: 0, nextAt: 0 };
  return state.attempts < Number(process.env.ERC8183_MAX_AGENT_RETRIES || 3) && Date.now() >= state.nextAt;
}
function recordRetry(key) {
  const state = retryState.get(key) || { attempts: 0, nextAt: 0 };
  state.attempts += 1;
  const base = Number(process.env.ERC8183_RETRY_BACKOFF_MS || 5000);
  state.nextAt = Date.now() + Math.min(base * 2 ** (state.attempts - 1), 60000);
  retryState.set(key, state);
  return state;
}

async function executeSelectedAgent(job, service) {
  const messageId = `${job.id.toString()}-${Date.now()}`;
  const isA2A = service.protocol === "a2a";
  const isERC8183Custom = service.protocol === "custom" && /erc.?8183/i.test(`${service.serviceName} ${service.endpoint}`);
  const body = isA2A ? { jsonrpc: "2.0", id: messageId, method: "message/send", params: { message: { messageId, role: "user", parts: [{ kind: "text", text: job.description }] } } } : { jobId: Number(job.id), agentId: Number(service.agentId), chainId: Number(service.chainId), task: job.description, protocol: isERC8183Custom ? "erc-8183" : "custom" };
  console.log(`[provider] invoking ${service.protocol} service ${service.serviceName} at ${service.endpoint}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.ERC8183_AGENT_TIMEOUT_MS || 120000));
  try {
    const response = await fetch(service.endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    const raw = await response.text(); let parsed = null; try { parsed = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) throw new Error(`Agent service ${service.serviceName} returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
    if (parsed?.error) throw new Error(`Agent endpoint returned JSON-RPC error: ${JSON.stringify(parsed.error)}`);
    const text = extractAgentText(parsed); if (!text && !raw) throw new Error("Agent endpoint returned an empty response");
    return { protocol: service.protocol, serviceName: service.serviceName, endpoint: service.endpoint, request: body, response: parsed ?? raw, text: text ?? raw, receivedAt: new Date().toISOString() };
  } finally { clearTimeout(timeout); }
}

async function executeDynamicAgent(job) {
  const match = String(job.description || "").match(/ERC-8004 agent\s+(\d+)/i);
  if (!match) throw new Error(`No ERC-8004 agent route found in job #${job.id}`);
  const service = await resolveAgentService(match[1], 97);
  console.log(`[provider] resolved ERC-8004 #${match[1]} ${service.serviceName} ${service.endpoint}`);
  const agentResult = await executeSelectedAgent(job, service);
  return { route: { agentId: match[1], chainId: 97, source: "erc8004-registration" }, service, agentResult };
}

async function pollJobs() {
  if (polling) return; polling = true;
  try {
    const counter = await client.commerce.jobCounter(); const recentJobIds = []; const firstId = counter > BigInt(batchSize - 1) ? counter - BigInt(batchSize - 1) : 1n;
    for (let id = firstId; id <= counter; id += 1n) recentJobIds.push(id);
    for (const job of await readJobs(recentJobIds)) { const key = job.id.toString(); if (job.provider.toLowerCase() !== jobOps.agentAddress.toLowerCase() || terminalFailures.has(key)) continue; if (job.status === 0) open.add(key); if (job.status === 1) funded.add(key); }
    const tracked = new Set([...open, ...budgeted, ...funded]); const openIds = new Set(); const fundedIds = new Set();
    for (const key of tracked) { try { const job = await client.getJob(BigInt(key)); if (job.provider.toLowerCase() !== jobOps.agentAddress.toLowerCase() || terminalFailures.has(key)) { open.delete(key); budgeted.delete(key); funded.delete(key); continue; } if (job.status === 0) openIds.add(key); else if (job.status === 1) fundedIds.add(key); else { open.delete(key); budgeted.delete(key); funded.delete(key); } } catch (error) { console.error(`[provider] getJob(${key}) failed:`, error instanceof Error ? error.message : error); } }
    for (const key of openIds) { if (budgeted.has(key)) continue; try { const result = await client.setBudget(BigInt(key), servicePrice); console.log(`[provider] set budget for #${key}: ${result.txHash || result.transactionHash || "submitted"}`); budgeted.add(key); open.delete(key); } catch (error) { console.error(`[provider] setBudget failed for #${key}:`, error instanceof Error ? error.message : error); } }
    for (const key of fundedIds) {
      if (terminalFailures.has(key) || !retryAllowed(key)) continue;
      try {
        const job = await client.getJob(BigInt(key)); if (job.status !== 1) { funded.delete(key); continue; }
        console.log(`[provider] funded job #${key}: ${job.description}`); const execution = await executeDynamicAgent(job);
        console.log(`[provider] agent #${key} returned: ${execution.agentResult.text.slice(0, 1000)}`);
        const deliverable = JSON.stringify({ status: "completed", jobId: Number(job.id), provider: jobOps.agentAddress, description: job.description, executedByAgent: true, routing: execution.route, service: { name: execution.service.serviceName, endpoint: execution.service.endpoint, protocol: execution.service.protocol }, agentResult: execution.agentResult, processedAt: new Date().toISOString() });
        const result = await jobOps.submitResult(Number(job.id), deliverable, { agentforge: true, worker: "agentforge-provider-v4", executedAgent: true, routing: "erc8004-registration" });
        if (!result.success) { const info = result.error || "submission failed"; if (result.retryable === true && retryAllowed(key)) { const retry = recordRetry(key); console.error(`[provider] submit failed for #${key}; retry ${retry.attempts}: ${info}`); } else { terminalFailures.add(key); funded.delete(key); console.error(`[provider] terminal submit failure for #${key}: ${info}`); } continue; }
        console.log(`[provider] submitted #${key}: ${result.txHash}`); funded.delete(key); retryState.delete(key);
      } catch (error) {
        const classification = classifyExecutionError(error); if (classification.terminal) { terminalFailures.add(key); funded.delete(key); retryState.delete(key); console.error(`[provider] terminal agent failure for #${key}: ${classification.message}`); } else { const retry = recordRetry(key); if (retry.attempts >= Number(process.env.ERC8183_MAX_AGENT_RETRIES || 3)) { terminalFailures.add(key); funded.delete(key); console.error(`[provider] retry limit reached for #${key}: ${classification.message}`); } else console.error(`[provider] funded job #${key} transient failure; retry ${retry.attempts}: ${classification.message}`); }
      }
    }
  } finally { polling = false; }
}

console.log(`[provider] address=${jobOps.agentAddress}`); console.log(`[provider] network=${network}`); console.log(`[provider] servicePrice=${servicePrice}`); console.log(`[provider] routing=dynamic ERC-8004 registration via 8004scan`); console.log(`[provider] retry policy=max ${process.env.ERC8183_MAX_AGENT_RETRIES || 3}, exponential backoff`); await pollJobs(); setInterval(() => void pollJobs(), pollIntervalMs);

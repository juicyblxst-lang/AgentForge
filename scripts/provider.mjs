import { createServer } from "node:http";
import { EVMWalletProvider, ERC8183Client, loadEnv } from "@bnbagent/sdk";
import { ERC8183JobOps } from "@bnbagent/sdk/erc8183";
import { LocalStorageProvider } from "@bnbagent/sdk/storage";
import { resolveAgentService, extractAgentRoute } from "./erc8004-agent.mjs";

loadEnv();

for (const name of ["WALLET_PASSWORD", "PRIVATE_KEY"]) {
  if (!process.env[name]) throw new Error(`${name} is required for the ERC-8183 provider worker`);
}

const network = process.env.NETWORK || "bsc-testnet";
if (network !== "bsc-testnet") throw new Error("AgentForge provider worker currently supports bsc-testnet only");

const servicePrice = BigInt(process.env.ERC8183_SERVICE_PRICE || "10000000000000000");
const port = Number(process.env.PORT || 3000);
const pollIntervalMs = Number(process.env.ERC8183_FUNDED_POLL_INTERVAL || 30) * 1000;
const batchSize = Number(process.env.ERC8183_JOB_BATCH_SIZE || 50);
const maxRetries = Number(process.env.ERC8183_MAX_AGENT_RETRIES || 3);
const retryBackoffMs = Number(process.env.ERC8183_RETRY_BACKOFF_MS || 5000);
const providerServiceUrl = (process.env.PROVIDER_SERVICE_URL || process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
const executionEndpoint = `${providerServiceUrl}/erc8183`;

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
  agentUrl: executionEndpoint,
  allowUnsignedJobs: true,
});

const budgeted = new Set();
const funded = new Set();
const open = new Set();
const terminalFailures = new Set();
const retryState = new Map();
const executing = new Set();
let polling = false;

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw new Error("Request body must be valid JSON"); }
}

function extractAgentText(value) {
  const parts = value?.result?.message?.parts || value?.result?.artifacts?.flatMap((artifact) => artifact.parts || []) || value?.message?.parts || value?.parts;
  if (Array.isArray(parts)) {
    const text = parts.map((part) => part?.text ?? part?.content ?? "").filter(Boolean).join("\n");
    if (text) return text;
  }
  if (typeof value?.result?.text === "string") return value.result.text;
  if (typeof value?.text === "string") return value.text;
  return null;
}

function classifyExecutionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/HTTP\s+(\d{3})/i)?.[1];
  if ((status && /^4\d\d$/.test(status)) || /no resolvable registration file/i.test(message)) return { terminal: true, message };
  return { terminal: false, message };
}

function retryAllowed(key) {
  const state = retryState.get(key) || { attempts: 0, nextAt: 0 };
  return state.attempts < maxRetries && Date.now() >= state.nextAt;
}

function recordRetry(key) {
  const state = retryState.get(key) || { attempts: 0, nextAt: 0 };
  state.attempts += 1;
  state.nextAt = Date.now() + Math.min(retryBackoffMs * 2 ** (state.attempts - 1), 60000);
  retryState.set(key, state);
  return state;
}

function isV1(service) {
  const version = String(service.protocolVersion || service.version || "");
  return /^1(?:\.0)?(?:\.|$)/.test(version);
}

function isJsonRpcBinding(service) {
  return /jsonrpc/i.test(String(service.protocolBinding || ""));
}

async function executeSelectedAgent(job, service) {
  const messageId = `${job.id.toString()}-${Date.now()}`;
  const v1 = isV1(service);
  const jsonRpc = isJsonRpcBinding(service) || !service.protocolBinding;
  const isA2A = service.protocol === "a2a";
  const isERC8183 = service.protocol === "erc-8183" || (service.protocol === "custom" && /erc.?8183/i.test(`${service.serviceName} ${service.endpoint}`));

  if (isERC8183 && !isA2A) {
    throw new Error(`ERC-8183 service ${service.serviceName} is advertised as a service endpoint, but AgentForge does not infer a non-standard request schema from ERC-8004 metadata`);
  }

  let body;
  let headers = { "content-type": v1 ? "application/a2a+json" : "application/json", accept: "application/json" };

  if (isA2A) {
    if (v1 && jsonRpc) {
      body = {
        jsonrpc: "2.0",
        id: messageId,
        method: "SendMessage",
        params: {
          message: {
            messageId,
            role: "ROLE_USER",
            parts: [{ text: { text: job.description } }],
          },
        },
      };
      headers = { ...headers, "A2A-Version": "1.0" };
    } else if (v1 && !jsonRpc) {
      body = {
        message: {
          messageId,
          role: "user",
          parts: [{ kind: "text", text: job.description }],
        },
      };
      headers = { ...headers, "A2A-Version": "1.0" };
    } else {
      body = {
        jsonrpc: "2.0",
        id: messageId,
        method: "message/send",
        params: {
          message: {
            messageId,
            role: "user",
            parts: [{ kind: "text", text: job.description }],
          },
        },
      };
    }
  } else {
    body = {
      jobId: Number(job.id),
      agentId: Number(service.agentId),
      chainId: Number(service.chainId),
      task: job.description,
      protocol: "custom",
    };
  }

  console.log(`[provider] invoking ${service.protocol} ${service.protocolVersion || service.version || "unknown"} ${service.protocolBinding || "default"} service ${service.serviceName} at ${service.endpoint}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.ERC8183_AGENT_TIMEOUT_MS || 120000));
  try {
    const response = await fetch(service.endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    const raw = await response.text();
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) throw new Error(`Agent service ${service.serviceName} returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
    if (parsed?.error) throw new Error(`Agent endpoint returned JSON-RPC error: ${JSON.stringify(parsed.error)}`);
    const text = extractAgentText(parsed);
    if (!text && !raw) throw new Error("Agent endpoint returned an empty response");
    return {
      protocol: service.protocol,
      protocolVersion: service.protocolVersion || service.version || null,
      protocolBinding: service.protocolBinding || null,
      serviceName: service.serviceName,
      endpoint: service.endpoint,
      registrationEndpoint: service.registrationEndpoint,
      request: body,
      response: parsed ?? raw,
      text: text ?? raw,
      receivedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function executeDynamicAgent(job) {
  const route = extractAgentRoute(job.description);
  if (!route?.agentId) throw new Error(`No ERC-8004 agent route found in job #${job.id}`);
  const agentId = route.agentId;
  const service = await resolveAgentService(agentId, route.chainId);
  console.log(`[provider] resolved ERC-8004 #${agentId} ${service.serviceName} ${service.endpoint} (${service.protocolVersion || "unknown"})`);
  const agentResult = await executeSelectedAgent(job, service);
  return { route: { agentId: String(agentId), chainId: Number(route.chainId), source: "erc8004-job-description" }, service, agentResult };
}

async function submitExecution(job, execution) {
  const deliverable = JSON.stringify({
    status: "completed",
    jobId: Number(job.id),
    provider: jobOps.agentAddress,
    description: job.description,
    executedByAgent: true,
    routing: execution.route,
    service: { name: execution.service.serviceName, endpoint: execution.service.endpoint, protocol: execution.service.protocol, protocolVersion: execution.service.protocolVersion || null, protocolBinding: execution.service.protocolBinding || null },
    agentResult: execution.agentResult,
    processedAt: new Date().toISOString(),
  });
  const result = await jobOps.submitResult(Number(job.id), deliverable, { agentforge: true, worker: "agentforge-provider-v6", executedAgent: true, routing: "erc8004-registration" });
  if (!result.success) throw new Error(result.error || "ERC-8183 result submission failed");
  return result;
}

async function processFundedJob(job) {
  const key = job.id.toString();
  if (executing.has(key)) return { accepted: false, reason: "already executing" };
  if (terminalFailures.has(key)) return { accepted: false, reason: "terminal failure" };
  if (job.provider.toLowerCase() !== jobOps.agentAddress.toLowerCase()) throw new Error("Job provider does not match AgentForge provider");
  if (job.status !== 1) throw new Error(`Job #${key} is not Funded`);
  executing.add(key);
  try {
    console.log(`[provider] executing funded job #${key}: ${job.description}`);
    const execution = await executeDynamicAgent(job);
    console.log(`[provider] agent #${key} returned: ${execution.agentResult.text.slice(0, 1000)}`);
    const result = await submitExecution(job, execution);
    console.log(`[provider] submitted #${key}: ${result.txHash}`);
    funded.delete(key); retryState.delete(key);
    return { accepted: true, result, execution };
  } catch (error) {
    const classification = classifyExecutionError(error);
    const message = classification.message;
    if (classification.terminal) {
      terminalFailures.add(key); funded.delete(key); retryState.delete(key);
      console.error(`[provider] terminal agent failure for #${key}: ${message}`);
    } else {
      const retry = recordRetry(key);
      if (retry.attempts >= maxRetries) { terminalFailures.add(key); funded.delete(key); console.error(`[provider] retry limit reached for #${key}: ${message}`); }
      else console.error(`[provider] funded job #${key} transient failure; retry ${retry.attempts}: ${message}`);
    }
    throw error;
  } finally { executing.delete(key); }
}

const httpServer = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/status") {
      sendJson(res, 200, { status: "ok", service: "agentforge-provider", network, chainId: 97, agentWallet: jobOps.agentAddress, servicePrice: servicePrice.toString(), executionEndpoint, routing: "dynamic-erc8004" });
      return;
    }
    if (req.method === "GET" && req.url === "/health") { sendJson(res, 200, { status: "ok", service: "agentforge-provider" }); return; }
    if (req.url === "/erc8183") {
      if (req.method !== "POST") { res.setHeader("Allow", "POST"); sendJson(res, 405, { error: "Method Not Allowed", endpoint: "/erc8183", method: "POST" }); return; }
      const body = await readJson(req);
      const jobId = Number(body.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) { sendJson(res, 400, { error: "jobId must be a positive integer" }); return; }
      const job = await client.getJob(BigInt(jobId));
      if (job.provider.toLowerCase() !== jobOps.agentAddress.toLowerCase()) { sendJson(res, 403, { error: "Job provider does not match AgentForge provider" }); return; }
      if (job.status !== 1) { sendJson(res, 409, { error: `Job #${jobId} is not Funded`, status: Number(job.status) }); return; }
      const processed = await processFundedJob(job);
      if (!processed.accepted) {
        if (processed.reason === "already executing") {
          sendJson(res, 202, { status: "processing", jobId, reason: processed.reason });
        } else {
          sendJson(res, 409, { error: `Job #${jobId} cannot be processed`, reason: processed.reason });
        }
        return;
      }
      sendJson(res, 200, { status: "submitted", jobId, txHash: processed.result.txHash, route: processed.execution.route, service: processed.execution.service, result: processed.execution.agentResult });
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[provider] HTTP execution error: ${message}`);
    sendJson(res, 502, { error: message });
  }
});

httpServer.listen(port, () => console.log(`[provider] HTTP server listening on :${port}; execution endpoint=${executionEndpoint}`));

async function readJobs(jobIds) {
  const jobs = [];
  for (let start = 0; start < jobIds.length; start += batchSize) {
    const results = await client.commerce.getJobsBatch(jobIds.slice(start, start + batchSize));
    for (const job of results) if (job) jobs.push(job);
  }
  return jobs;
}

async function pollJobs() {
  if (polling) return;
  polling = true;
  try {
    const counter = await client.commerce.jobCounter();
    const recentJobIds = [];
    const firstId = counter > BigInt(batchSize - 1) ? counter - BigInt(batchSize - 1) : 1n;
    for (let id = firstId; id <= counter; id += 1n) recentJobIds.push(id);
    for (const job of await readJobs(recentJobIds)) {
      const key = job.id.toString();
      if (job.provider.toLowerCase() !== jobOps.agentAddress.toLowerCase() || terminalFailures.has(key)) continue;
      if (job.status === 0) open.add(key);
      if (job.status === 1) funded.add(key);
    }
    const tracked = new Set([...open, ...budgeted, ...funded]);
    const openIds = new Set();
    const fundedIds = new Set();
    for (const key of tracked) {
      try {
        const job = await client.getJob(BigInt(key));
        if (job.provider.toLowerCase() !== jobOps.agentAddress.toLowerCase() || terminalFailures.has(key)) { open.delete(key); budgeted.delete(key); funded.delete(key); continue; }
        if (job.status === 0) openIds.add(key);
        else if (job.status === 1) fundedIds.add(key);
        else { open.delete(key); budgeted.delete(key); funded.delete(key); }
      } catch (error) { console.error(`[provider] getJob(${key}) failed:`, error instanceof Error ? error.message : error); }
    }
    for (const key of openIds) {
      if (budgeted.has(key)) continue;
      try { const result = await client.setBudget(BigInt(key), servicePrice); console.log(`[provider] set budget for #${key}: ${result.txHash || result.transactionHash || "submitted"}`); budgeted.add(key); open.delete(key); }
      catch (error) { console.error(`[provider] setBudget failed for #${key}:`, error instanceof Error ? error.message : error); }
    }
    for (const key of fundedIds) {
      if (terminalFailures.has(key) || !retryAllowed(key) || executing.has(key)) continue;
      try {
        const job = await client.getJob(BigInt(key));
        if (job.status !== 1) { funded.delete(key); continue; }
        void processFundedJob(job).catch((error) => console.error(`[provider] funded job #${key} execution cycle ended:`, error instanceof Error ? error.message : error));
      } catch (error) { console.error(`[provider] funded job #${key} dispatch failed:`, error instanceof Error ? error.message : error); }
    }
  } finally { polling = false; }
}

console.log(`[provider] address=${jobOps.agentAddress}`);
console.log(`[provider] network=${network}`);
console.log(`[provider] servicePrice=${servicePrice}`);
console.log(`[provider] execution endpoint=${executionEndpoint}`);
console.log(`[provider] routing=dynamic ERC-8004 registration via 8004scan`);
console.log(`[provider] retry policy=max ${maxRetries}, exponential backoff`);
console.log(`[provider] execution is non-blocking; budget polling remains independent of agent latency`);
await pollJobs();
setInterval(() => void pollJobs(), pollIntervalMs);
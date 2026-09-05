import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import agentCapabilities from './api/agent-capabilities.js';
import providerExecute from './api/provider-execute.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const dist = join(root, 'dist');
const port = Number(process.env.PORT || 3000);
const subgraphId = process.env.AGENT0_SUBGRAPH_ID || 'BTjind17gmRZ6YhT9peaCM13SvWuqztsmqyfjpntbg3Z';
const apiKey = process.env.AGENT0_GRAPH_API_KEY;
const endpoint = process.env.AGENT0_GRAPH_URL || `https://gateway.thegraph.com/api/subgraphs/id/${subgraphId}`;
const providerAddress = process.env.AGENTFORGE_PROVIDER_ADDRESS || '';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseServiceRoleKey ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const query = `query Agents($first: Int!, $skip: Int!) { agents(first: $first, skip: $skip, orderBy: lastActivity, orderDirection: desc) { id agentId chainId owner agentWallet agentURI registrationFile { name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills supportedTrusts x402Support } } }`;
const STATUSES = new Set(['CREATED','REGISTERED','FUNDED','SUBMITTED','SETTLED','VERIFIED','FAILED']);
const agentCardCache = new Map();
const AGENT_CARD_TTL_MS = 6 * 60 * 60 * 1000;

function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
async function readBody(req) { let body = ''; for await (const chunk of req) body += chunk; if (body.length > 100_000) throw new Error('Request body too large'); return JSON.parse(body || '{}'); }

function mountApiHandler(handler, req, res, body) {
  req.body = body;
  res.status = (statusCode) => { res.statusCode = statusCode; return res; };
  res.json = (payload) => {
    if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
  return handler(req, res);
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && !host.startsWith('169.254.') && !host.startsWith('10.') && !host.startsWith('192.168.') && !/^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  } catch {
    return false;
  }
}

async function fetchAgentCard(a2aEndpoint) {
  if (!isPublicHttpUrl(a2aEndpoint)) return null;
  const base = a2aEndpoint.replace(/\/+$/, '');
  const candidates = [`${base}/.well-known/agent-card.json`, `${base}/.well-known/agent.json`];

  for (const cardUrl of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let response;
      try {
        response = await fetch(cardUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) continue;
      const card = await response.json();
      if (!card || typeof card !== 'object' || !Array.isArray(card.skills)) continue;

      return {
        source: 'a2a_agent_card',
        agentCardUrl: cardUrl,
        skills: card.skills,
        capabilities: card.capabilities ?? {},
        url: card.url ?? a2aEndpoint,
        verified: true,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      // Try the legacy Agent Card location before reporting no capabilities.
    }
  }
  return null;
}

async function agentCard(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const a2aEndpoint = (url.searchParams.get('endpoint') || '').trim();
  if (!a2aEndpoint) return json(res, 400, { error: 'missing endpoint' });
  if (!isPublicHttpUrl(a2aEndpoint)) return json(res, 400, { error: 'invalid public HTTP endpoint' });

  const cached = agentCardCache.get(a2aEndpoint);
  if (cached && cached.expires > Date.now()) return json(res, 200, cached.data);

  const result = await fetchAgentCard(a2aEndpoint);
  const payload = result ?? { source: 'none', agentCardUrl: null, skills: [], capabilities: {}, verified: false };
  agentCardCache.set(a2aEndpoint, { data: payload, expires: Date.now() + AGENT_CARD_TTL_MS });
  return json(res, 200, payload);
}

async function agents(req, res) {
  if (!apiKey && !process.env.AGENT0_GRAPH_URL) return json(res, 503, { error: 'AGENT0_GRAPH_API_KEY is not configured on the server' });
  const url = new URL(req.url, `http://${req.headers.host}`); const first = Math.min(Math.max(Number(url.searchParams.get('first') || 20), 1), 100); const skip = Math.max(Number(url.searchParams.get('skip') || 0), 0);
  try { const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ query, variables: { first, skip } }) }); const body = await response.json(); if (!response.ok || body.errors?.length) return json(res, 502, { error: body.errors?.[0]?.message || `The Graph returned ${response.status}` }); return json(res, 200, { agents: body.data?.agents ?? [], pagination: { first, skip, returned: body.data?.agents?.length ?? 0 } }); } catch (error) { return json(res, 502, { error: error instanceof Error ? error.message : 'Agent discovery request failed' }); }
}
function provider(req, res) { return json(res, 200, { configured: Boolean(providerAddress), address: providerAddress || null, chainId: 97 }); }

function mapExecution(row) { return { id:row.id, agentId:row.agent_id, agentName:row.agent_name, wallet:row.wallet, chainId:row.chain_id, protocol:row.protocol, jobId:row.job_id, createHash:row.create_hash, fundHash:row.fund_hash, status:row.status, createdAt:row.created_at, updatedAt:row.updated_at, submittedAt:row.submitted_at, settledAt:row.settled_at, deliverable:row.deliverable }; }

async function executions(req, res) {
  if (!supabase) return json(res, 503, { error: 'Supabase persistence is not configured on the server' });
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`); const wallet = (url.searchParams.get('wallet') || '').trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(wallet)) return json(res, 400, { error: 'A valid wallet address is required' });
      const { data, error } = await supabase.from('agentforge_executions').select('*').eq('wallet', wallet).order('created_at', { ascending: false }).limit(50);
      if (error) return json(res, 502, { error: error.message }); return json(res, 200, { executions:(data ?? []).map(mapExecution) });
    }
    if (req.method === 'POST') {
      const body = await readBody(req); const wallet = String(body.wallet || '').trim().toLowerCase(); const status = String(body.status || '');
      if (!/^0x[a-f0-9]{40}$/.test(wallet)) return json(res, 400, { error: 'Invalid wallet address' });
      if (!STATUSES.has(status)) return json(res, 400, { error: `Invalid execution status: ${status}` });
      const row = { id:String(body.id || ''), agent_id:String(body.agentId || ''), agent_name:String(body.agentName || ''), wallet, chain_id:97, protocol:'ERC-8183', job_id:String(body.jobId || ''), create_hash:String(body.createHash || ''), fund_hash:String(body.fundHash || ''), status, submitted_at:body.submittedAt ? String(body.submittedAt) : null, settled_at:body.settledAt ? String(body.settledAt) : null, deliverable:body.deliverable ? String(body.deliverable) : null, created_at:String(body.createdAt || new Date().toISOString()), updated_at:new Date().toISOString() };
      if (!row.id || !row.agent_id || !row.agent_name || !row.job_id || !row.create_hash || !row.fund_hash) return json(res, 400, { error: 'Invalid execution record' });
      const { data, error } = await supabase.from('agentforge_executions').upsert(row, { onConflict:'id' }).select().single();
      if (error) return json(res, 502, { error: error.message }); return json(res, 200, { execution:mapExecution(data) });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' }); }
}

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
createServer(async (req, res) => { try {
  if (req.url?.startsWith('/api/agent-capabilities')) return mountApiHandler(agentCapabilities, req, res);
  if (req.url?.startsWith('/api/provider-execute')) { const body = await readBody(req); return mountApiHandler(providerExecute, req, res, body); }
  if (req.url?.startsWith('/api/agents')) return agents(req, res);
  if (req.url?.startsWith('/api/agent-card')) return agentCard(req, res);
  if (req.url?.startsWith('/api/provider')) return provider(req, res);
  if (req.url?.startsWith('/api/executions')) return executions(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
  const pathname = new URL(req.url || '/', `http://${req.headers.host}`).pathname; const safe = normalize(pathname).replace(/^([.][.][/\\])+/, ''); const candidate = join(dist, safe === '/' ? 'index.html' : safe); let file; try { file = await readFile(candidate); } catch { file = await readFile(join(dist, 'index.html')); } res.writeHead(200, { 'content-type': mime[extname(candidate)] || 'application/octet-stream' }); if (req.method !== 'HEAD') res.end(file); else res.end();
} catch (error) { json(res, 500, { error: error instanceof Error ? error.message : 'Internal server error' }); } }).listen(port, () => console.log(`AgentForge listening on :${port}`));
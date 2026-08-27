import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const dist = join(root, 'dist');
const port = Number(process.env.PORT || 3000);
const subgraphId = process.env.AGENT0_SUBGRAPH_ID || 'BTjind17gmRZ6YhT9peaCM13SvWuqztsmqyfjpntbg3Z';
const apiKey = process.env.AGENT0_GRAPH_API_KEY;
const endpoint = process.env.AGENT0_GRAPH_URL || `https://gateway.thegraph.com/api/subgraphs/id/${subgraphId}`;
const providerAddress = process.env.AGENTFORGE_PROVIDER_ADDRESS || '';
const query = `query Agents($first: Int!, $skip: Int!) {
  agents(first: $first, skip: $skip, orderBy: lastActivity, orderDirection: desc) {
    id agentId chainId owner agentWallet agentURI
    registrationFile {
      name description active mcpEndpoint a2aEndpoint mcpTools a2aSkills supportedTrusts x402Support
    }
  }
}`;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function agents(req, res) {
  if (!apiKey && !process.env.AGENT0_GRAPH_URL) return json(res, 503, { error: 'AGENT0_GRAPH_API_KEY is not configured on the server' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const first = Math.min(Math.max(Number(url.searchParams.get('first') || 20), 1), 100);
  const skip = Math.max(Number(url.searchParams.get('skip') || 0), 0);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ query, variables: { first, skip } }),
    });
    const body = await response.json();
    if (!response.ok || body.errors?.length) return json(res, 502, { error: body.errors?.[0]?.message || `The Graph returned ${response.status}` });
    return json(res, 200, { agents: body.data?.agents ?? [], pagination: { first, skip, returned: body.data?.agents?.length ?? 0 } });
  } catch (error) {
    return json(res, 502, { error: error instanceof Error ? error.message : 'Agent discovery request failed' });
  }
}

function provider(req, res) {
  return json(res, 200, { configured: Boolean(providerAddress), address: providerAddress || null, chainId: 97 });
}

const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/api/agents')) return agents(req, res);
    if (req.url?.startsWith('/api/provider')) return provider(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    const pathname = new URL(req.url || '/', `http://${req.headers.host}`).pathname;
    const safe = normalize(pathname).replace(/^([.][.][/\\])+/, '');
    const candidate = join(dist, safe === '/' ? 'index.html' : safe);
    let file;
    try { file = await readFile(candidate); } catch { file = await readFile(join(dist, 'index.html')); }
    res.writeHead(200, { 'content-type': mime[extname(candidate)] || 'application/octet-stream' });
    if (req.method !== 'HEAD') res.end(file); else res.end();
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : 'Internal server error' });
  }
}).listen(port, () => console.log(`AgentForge listening on :${port}`));

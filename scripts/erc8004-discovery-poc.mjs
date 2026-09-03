import { createPublicClient, http, parseAbiItem } from 'viem';
import { bscTestnet } from 'viem/chains';

const CHAIN_ID = 97;
const REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const RPC = process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545';
const CHUNK = BigInt(process.env.ERC8004_DISCOVERY_CHUNK || 10_000);
const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
const registeredEvent = parseAbiItem('event Registered(uint256 indexed agentId, string agentURI, address indexed owner)');
const identityAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getAgentWallet', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ type: 'address' }] },
];

function decodeDataUri(uri) {
  const match = uri.match(/^data:application\/json(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  try { return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); } catch { return null; }
}
function normalizeUri(uri) { return uri.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri; }
async function resolveMetadata(uri) {
  const decoded = decodeDataUri(uri);
  if (decoded) return decoded;
  const response = await fetch(normalizeUri(uri), { headers: { accept: 'application/json' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`metadata HTTP ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
function services(registration) {
  const raw = Array.isArray(registration?.services) ? registration.services : Array.isArray(registration?.endpoints) ? registration.endpoints : [];
  return raw.filter(s => typeof s?.endpoint === 'string').map(s => ({ name: s.name, endpoint: s.endpoint, skills: s.skills || [], domains: s.domains || [] }));
}
async function verifyEndpoint(endpoint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(endpoint, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
      return { reachable: true, status: response.status };
    } finally { clearTimeout(timeout); }
  } catch { return { reachable: false }; }
}

const network = await client.getChainId();
if (network !== CHAIN_ID) throw new Error(`Expected BSC Testnet 97, got ${network}`);
const latest = await client.getBlockNumber();
const ids = new Set();
for (let start = 0n; start <= latest; start += CHUNK) {
  const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
  const logs = await client.getLogs({ address: REGISTRY, event: registeredEvent, fromBlock: start, toBlock: end });
  for (const log of logs) if (log.args.agentId !== undefined) ids.add(log.args.agentId.toString());
  process.stdout.write(`scanned ${start}-${end}; discovered=${ids.size}\r`);
}
console.log(`\nBSC Testnet ERC-8004 registry: ${REGISTRY}`);
console.log(`Registered agents discovered from on-chain Registered events: ${ids.size}`);
for (const id of [...ids].sort((a,b) => BigInt(a) < BigInt(b) ? -1 : 1)) {
  try {
    const [owner, wallet, uri] = await Promise.all([
      client.readContract({ address: REGISTRY, abi: identityAbi, functionName: 'ownerOf', args: [BigInt(id)] }),
      client.readContract({ address: REGISTRY, abi: identityAbi, functionName: 'getAgentWallet', args: [BigInt(id)] }),
      client.readContract({ address: REGISTRY, abi: identityAbi, functionName: 'tokenURI', args: [BigInt(id)] }),
    ]);
    const registration = await resolveMetadata(uri);
    const svc = services(registration);
    const checked = await Promise.all(svc.map(async s => ({ ...s, verification: await verifyEndpoint(s.endpoint) })));
    console.log(JSON.stringify({ agentId: id, chainId: CHAIN_ID, registryAddress: REGISTRY, owner, agentWallet: wallet, metadataUri: uri, name: registration.name, description: registration.description, capabilities: [...new Set(checked.flatMap(s => s.skills).filter(Boolean))], services: checked, active: registration.active }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ agentId: id, status: 'unavailable', error: error instanceof Error ? error.message : String(error) }));
  }
}

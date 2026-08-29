import { getAddress, type PublicClient } from 'viem';
import { CONTRACTS, publicClient, assertBscTestnet } from './chain';

const identityAbi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getAgentWallet', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ type: 'address' }] },
] as const;

export type AgentIdentity = { agentId: bigint; owner: string; agentWallet: string; agentURI: string; chainId: 97 };

export type CapabilityVerification = {
  verified: boolean;
  active: boolean;
  registrationBound: boolean;
  capabilities: string[];
  reason?: string;
};

export async function getAgentIdentity(agentId: bigint, client: PublicClient = publicClient()): Promise<AgentIdentity> {
  await assertBscTestnet(client);
  const [owner, agentWallet, agentURI] = await Promise.all([
    client.readContract({ address: CONTRACTS.identityRegistry, abi: identityAbi, functionName: 'ownerOf', args: [agentId] }),
    client.readContract({ address: CONTRACTS.identityRegistry, abi: identityAbi, functionName: 'getAgentWallet', args: [agentId] }),
    client.readContract({ address: CONTRACTS.identityRegistry, abi: identityAbi, functionName: 'tokenURI', args: [agentId] }),
  ]);
  return { agentId, owner: getAddress(owner), agentWallet: getAddress(agentWallet), agentURI, chainId: 97 };
}

export function normalizeAgentURI(uri: string) {
  if (uri.startsWith('data:')) return uri;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  return uri;
}

async function readRegistration(uri: string): Promise<any> {
  if (uri.startsWith('data:application/json;base64,')) {
    const encoded = uri.slice('data:application/json;base64,'.length);
    return JSON.parse(atob(encoded));
  }
  if (uri.startsWith('data:application/json,')) {
    return JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)));
  }
  const response = await fetch(normalizeAgentURI(uri));
  if (!response.ok) throw new Error(`ERC-8004 registration could not be loaded (${response.status})`);
  return response.json();
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
}

function capabilityStrings(value: unknown): string[] {
  return strings(value).filter((value) => !/^https?:\/\//i.test(value) && !/^a2a:\s*https?:\/\//i.test(value));
}

function isA2AService(service: any): boolean {
  const values = [service?.name, service?.type, service?.protocol, service?.kind, service?.serviceType]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase());

  return values.some((value) => value === 'a2a' || value === 'a2a-http' || value === 'a2a_http' || value === 'a2a/https');
}

async function readA2ACapabilities(endpoint: unknown): Promise<string[]> {
  if (typeof endpoint !== 'string' || !endpoint || endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) return [];
  try {
    // The Agent Card is fetched by AgentForge's server-side resolver so the
    // third-party agent does not need to enable browser CORS for our origin.
    const response = await fetch(`/api/agent-card?endpoint=${encodeURIComponent(endpoint)}`);
    if (!response.ok) return [];
    const data = await response.json();
    if (!data?.verified || !Array.isArray(data.skills)) return [];
    return data.skills.flatMap((skill: any) => {
      const name = typeof skill?.name === 'string' ? skill.name.trim() : '';
      const id = typeof skill?.id === 'string' ? skill.id.trim() : '';
      const tags = capabilityStrings(skill?.tags);
      return [name || id, ...tags].filter(Boolean);
    });
  } catch {
    return [];
  }
}

export async function verifyAgentCapabilities(identity: AgentIdentity): Promise<CapabilityVerification> {
  const registration = await readRegistration(identity.agentURI);
  const expectedRegistration = `eip155:${identity.chainId}:${CONTRACTS.identityRegistry.toLowerCase()}`;
  const registrations = Array.isArray(registration?.registrations) ? registration.registrations : [];
  const registrationBound = registrations.some((entry: any) =>
    Number(entry?.agentId) === Number(identity.agentId) &&
    String(entry?.agentRegistry ?? '').toLowerCase() === expectedRegistration,
  );

  const services = Array.isArray(registration?.services) ? registration.services : [];
  const serviceCapabilities = services.flatMap((service: any) => {
    const values: string[] = [];
    values.push(...capabilityStrings(service?.skills));
    values.push(...capabilityStrings(service?.tools));
    values.push(...capabilityStrings(service?.a2aSkills));
    values.push(...capabilityStrings(service?.mcpTools));
    return values;
  });

  const fallbackCapabilities = [
    ...capabilityStrings(registration?.capabilities),
    ...capabilityStrings(registration?.a2aSkills),
    ...capabilityStrings(registration?.mcpTools),
  ];

  const a2aEndpoints = services
    .filter(isA2AService)
    .map((service: any) => service?.endpoint)
    .filter((endpoint: unknown): endpoint is string => typeof endpoint === 'string');

  const a2aCardCapabilities = (await Promise.all(a2aEndpoints.map(readA2ACapabilities))).flat();
  const uniqueCapabilities = [...new Set([...serviceCapabilities, ...fallbackCapabilities, ...a2aCardCapabilities])];
  const active = registration?.active !== false;
  const verified = registrationBound && active && uniqueCapabilities.length > 0;

  return {
    verified,
    active,
    registrationBound,
    capabilities: uniqueCapabilities,
    reason: verified
      ? undefined
      : !registrationBound
        ? 'Registration file is not cryptographically bound to this ERC-8004 agent.'
        : !active
          ? 'Agent registration is marked inactive.'
          : 'No declared capabilities were found in the registration file or its public A2A Agent Card.',
  };
}

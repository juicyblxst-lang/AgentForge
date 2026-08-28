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

export async function verifyAgentCapabilities(identity: AgentIdentity): Promise<CapabilityVerification> {
  const registration = await readRegistration(identity.agentURI);
  const expectedRegistration = `eip155:${identity.chainId}:${CONTRACTS.identityRegistry.toLowerCase()}`;
  const registrations = Array.isArray(registration?.registrations) ? registration.registrations : [];
  const registrationBound = registrations.some((entry: any) =>
    Number(entry?.agentId) === Number(identity.agentId) &&
    String(entry?.agentRegistry ?? '').toLowerCase() === expectedRegistration,
  );

  const services = Array.isArray(registration?.services) ? registration.services : [];
  const capabilities = services.flatMap((service: any) => {
    const values: string[] = [];
    if (Array.isArray(service?.skills)) values.push(...service.skills.filter((x: unknown): x is string => typeof x === 'string'));
    if (Array.isArray(service?.tools)) values.push(...service.tools.filter((x: unknown): x is string => typeof x === 'string'));
    if (service?.name === 'MCP' && service?.endpoint) values.push(`MCP:${service.endpoint}`);
    if (service?.name === 'A2A' && service?.endpoint) values.push(`A2A:${service.endpoint}`);
    return values;
  });

  const fallbackCapabilities = [
    ...(Array.isArray(registration?.capabilities) ? registration.capabilities : []),
  ].filter((x: unknown): x is string => typeof x === 'string');
  const uniqueCapabilities = [...new Set([...capabilities, ...fallbackCapabilities])];
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
          : 'No declared capabilities were found in the registration file.',
  };
}

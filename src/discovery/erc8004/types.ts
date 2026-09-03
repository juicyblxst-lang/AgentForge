export type ServiceProtocol='A2A'|'MCP'|'OASF'|'ERC-8183'|'HTTP'|'UNKNOWN';
export type DiscoveredService={name?:string;endpoint:string;protocol:ServiceProtocol;version?:string;skills:string[];domains:string[];reachable:boolean;httpStatus?:number;verifiedAt:string};
export type DiscoveredAgent={agentId:string;chainId:number;registryAddress:string;owner:string;agentWallet?:string;metadataUri:string;name?:string;description?:string;active?:boolean;capabilities:string[];services:DiscoveredService[];status:'verified'|'unverified'|'unavailable';discoveredAt:string;lastVerifiedAt?:string};
export type DiscoveryOptions={fromBlock?:bigint;toBlock?:bigint;chunkSize?:bigint;verifyServices?:boolean;concurrency?:number};
export interface AgentDiscoveryProvider{discoverAgents(options?:DiscoveryOptions):Promise<DiscoveredAgent[]>}

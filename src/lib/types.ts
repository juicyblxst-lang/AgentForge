export type Capability = { id: string; name: string; protocol: 'ERC-8183' | 'A2A' | 'MCP' | 'UNKNOWN'; executable: boolean; description?: string };

export type ExecutionStatus = 'CREATED' | 'AUTHORIZED' | 'SUBMITTED' | 'PENDING' | 'CONFIRMED' | 'VERIFIED' | 'FAILED' | 'UNKNOWN';

export type Execution = {
  id: string;
  agentId: string;
  agentName: string;
  capability: Capability;
  wallet: string;
  chainId: 97;
  protocol: 'ERC-8183';
  task: string;
  budget: string;
  txHash?: string;
  jobId?: string;
  status: ExecutionStatus;
  verification?: { verified: boolean; blockNumber?: string; reasons: string[] };
  createdAt: string;
  updatedAt: string;
};

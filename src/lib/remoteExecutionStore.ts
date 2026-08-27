import type { StoredExecution } from './executionStore';

export async function loadRemoteExecutions(wallet: string): Promise<StoredExecution[]> {
  const response = await fetch(`/api/executions?wallet=${encodeURIComponent(wallet)}`);
  if (!response.ok) throw new Error(`Execution history unavailable (${response.status})`);
  const data = await response.json() as { executions?: StoredExecution[]; error?: string };
  if (data.error) throw new Error(data.error);
  return data.executions ?? [];
}

export async function persistRemoteExecution(execution: StoredExecution): Promise<StoredExecution> {
  const response = await fetch('/api/executions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(execution),
  });
  if (!response.ok) throw new Error(`Execution persistence failed (${response.status})`);
  const data = await response.json() as { execution?: StoredExecution; error?: string };
  if (data.error || !data.execution) throw new Error(data.error || 'Execution persistence failed');
  return data.execution;
}

import type { Execution, ExecutionStatus } from './types';

const KEY = 'agentforge.executions.v2';
const replacer = (_key: string, value: unknown) => typeof value === 'bigint' ? `${value}n` : value;
const reviver = (_key: string, value: unknown) => typeof value === 'string' && /^\d+n$/.test(value) ? BigInt(value.slice(0, -1)) : value;

export function getExecutions(): Execution[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]', reviver) as Execution[]; } catch { return []; }
}
export function getExecution(id: string) { return getExecutions().find(x => x.id === id); }
export function upsertExecution(execution: Execution) {
  const all = getExecutions().filter(x => x.id !== execution.id);
  localStorage.setItem(KEY, JSON.stringify([execution, ...all], replacer));
  return execution;
}
export function updateExecution(id: string, patch: Partial<Execution>) {
  const current = getExecution(id); if (!current) return undefined;
  return upsertExecution({ ...current, ...patch, updatedAt: new Date().toISOString() });
}
export function transition(id: string, status: ExecutionStatus, patch: Partial<Execution> = {}) { return updateExecution(id, { status, ...patch }); }

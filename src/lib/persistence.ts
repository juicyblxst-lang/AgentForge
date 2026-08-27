import type { ExecutionRecord } from './execution';

const KEY = 'agentforge.executions.v1';

export function listExecutions(): ExecutionRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]', (_k, v) => typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v); } catch { return []; }
}

export function saveExecution(record: ExecutionRecord) {
  const records = listExecutions().filter(x => x.id !== record.id);
  records.unshift(record);
  localStorage.setItem(KEY, JSON.stringify(records, (_k, v) => typeof v === 'bigint' ? `${v}n` : v));
  return record;
}

export function getExecution(id: string) { return listExecutions().find(x => x.id === id); }

export type StoredExecution = { id:string; agentId:string; agentName:string; wallet:string; chainId:97; protocol:'ERC-8183'; jobId:string; createHash:string; fundHash:string; status:'FUNDED'|'CONFIRMED'|'VERIFIED'|'FAILED'; createdAt:string };
const KEY='agentforge.live-executions.v1';
export function listStoredExecutions():StoredExecution[]{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}}
export function saveStoredExecution(x:StoredExecution){const all=listStoredExecutions().filter(e=>e.id!==x.id);localStorage.setItem(KEY,JSON.stringify([x,...all]));return x}

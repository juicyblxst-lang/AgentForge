export type ExecutionStatus = 'CREATED'|'REGISTERED'|'FUNDED'|'SUBMITTED'|'SETTLED'|'VERIFIED'|'FAILED';
export type StoredExecution = { id:string; agentId:string; agentName:string; wallet:string; chainId:97; protocol:'ERC-8183'; jobId:string; createHash:string; fundHash:string; status:ExecutionStatus; createdAt:string; updatedAt?:string; submittedAt?:string; settledAt?:string; deliverable?:string };
const KEY='agentforge.live-executions.v2';

export function listStoredExecutions():StoredExecution[]{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}}
export function saveStoredExecution(x:StoredExecution){const all=listStoredExecutions().filter(e=>e.id!==x.id);localStorage.setItem(KEY,JSON.stringify([x,...all]));return x}

export async function syncExecution(x:StoredExecution):Promise<StoredExecution>{
  saveStoredExecution(x);
  try {
    const response=await fetch('/api/executions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(x)});
    if(!response.ok) return x;
    const body=await response.json();
    const remote=body.execution as StoredExecution|undefined;
    if(remote) saveStoredExecution(remote);
    return remote||x;
  } catch { return x; }
}

export async function recoverExecutions(wallet:string):Promise<StoredExecution[]>{
  const local=listStoredExecutions();
  try {
    const response=await fetch(`/api/executions?wallet=${encodeURIComponent(wallet)}`);
    if(!response.ok) return local;
    const body=await response.json();
    const remote=Array.isArray(body.executions)?body.executions as StoredExecution[]:[];
    for(const item of remote) saveStoredExecution(item);
    return [...remote,...local.filter(x=>!remote.some(r=>r.id===x.id))].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  } catch { return local; }
}

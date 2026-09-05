// Temporary startup diagnostics. Never print secret values.
const required = ["WALLET_PASSWORD", "PRIVATE_KEY"];
const present = Object.fromEntries(required.map((name) => [name, Boolean(process.env[name])]));
console.log(`[env-debug] required variable presence: ${JSON.stringify(present)}`);
console.log(`[env-debug] matching process.env keys: ${Object.keys(process.env).filter((key) => required.includes(key)).join(",") || "none"}`);
console.log(`[env-debug] Render external URL present: ${Boolean(process.env.RENDER_EXTERNAL_URL)}`);
console.log(`[env-debug] NODE_ENV present: ${Boolean(process.env.NODE_ENV)}`);

// A2A JSON-RPC uses application/json. Keep the provider transport compatible
// with agents that correctly enforce the JSON-RPC media type (e.g. RangeKeeper).
const originalFetch = globalThis.fetch;
function isJsonRpcRequest(body) {
  if (typeof body !== "string") return false;
  try {
    const parsed = JSON.parse(body);
    return parsed && parsed.jsonrpc === "2.0" && typeof parsed.method === "string";
  } catch {
    return false;
  }
}
globalThis.fetch = async (input, init = {}) => {
  if (!init || !isJsonRpcRequest(init.body)) return originalFetch(input, init);
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json");
  return originalFetch(input, { ...init, headers });
};

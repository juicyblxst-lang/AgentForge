// Normalize A2A JSON-RPC requests at the transport boundary.
// JSON-RPC over HTTP uses application/json; application/a2a+json is for the
// HTTP+JSON/REST binding. Some registered agents (including RangeKeeper) reject
// JSON-RPC requests sent with the REST media type even when their Agent Card
// advertises JSON-RPC.
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

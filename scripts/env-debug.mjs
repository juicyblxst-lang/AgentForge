// Temporary startup diagnostics. Never print secret values.
const required = ["WALLET_PASSWORD", "PRIVATE_KEY"];
const present = Object.fromEntries(required.map((name) => [name, Boolean(process.env[name])]));
console.log(`[env-debug] required variable presence: ${JSON.stringify(present)}`);
console.log(`[env-debug] matching process.env keys: ${Object.keys(process.env).filter((key) => required.includes(key)).join(",") || "none"}`);
console.log(`[env-debug] Render external URL present: ${Boolean(process.env.RENDER_EXTERNAL_URL)}`);
console.log(`[env-debug] NODE_ENV present: ${Boolean(process.env.NODE_ENV)}`);

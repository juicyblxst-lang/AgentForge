import { AgentEndpoint, ERC8004Agent } from "@bnbagent/sdk/erc8004";
import { EVMWalletProvider, loadEnv } from "@bnbagent/sdk";

loadEnv();

const network = process.env.NETWORK || "bsc-testnet";
const walletPassword = process.env.WALLET_PASSWORD;
const privateKey = process.env.PRIVATE_KEY;
if (!walletPassword) throw new Error("WALLET_PASSWORD is required");
if (!privateKey) throw new Error("PRIVATE_KEY is required on first registration");

const agentHost = (process.env.ERC8183_AGENT_URL || "").replace(/\/+$/, "");
if (!agentHost) throw new Error("ERC8183_AGENT_URL must be the public provider URL, e.g. https://provider.example/erc8183");

const name = process.env.AGENT_NAME || "AgentForge Provider";
const description = process.env.AGENT_DESCRIPTION || "AgentForge controlled ERC-8183 BSC Testnet provider for marketplace execution demos.";

const wallet = new EVMWalletProvider({ password: walletPassword, privateKey });
const sdk = await ERC8004Agent.create({ walletProvider: wallet, network });
const agentUri = sdk.generateAgentUri({
  name,
  description,
  endpoints: [new AgentEndpoint({ name: "ERC-8183", endpoint: `${agentHost}/status`, version: "0.1.0" })],
});

console.log(`Registering ${name} from wallet ${sdk.walletAddress}`);
const result = await sdk.registerAgent(agentUri);
console.log(`transaction: ${result.transactionHash}`);
console.log(`agentId: ${result.agentId}`);
console.log(`providerAddress: ${sdk.walletAddress}`);

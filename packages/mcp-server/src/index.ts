import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiClient } from "./client";
import { createScanpalServer } from "./server";

const apiKey = process.env.SCANPAL_API_KEY;
if (!apiKey) {
  console.error("SCANPAL_API_KEY ontbreekt — maak een key in de webapp (Settings → API-keys)");
  process.exit(1);
}

const baseUrl = process.env.SCANPAL_API_URL ?? "http://localhost:3000";

const server = createScanpalServer(createApiClient({ baseUrl, apiKey }));
const transport = new StdioServerTransport();
await server.connect(transport);

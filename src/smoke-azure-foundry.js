import { azureFoundryClientFromEnvironment } from "./agents/azure-foundry-client.js";

const client = azureFoundryClientFromEnvironment(process.env, { maximumAttempts: 1 });
const response = await client.complete({
  messages: [
    { role: "system", content: "Return valid JSON only." },
    { role: "user", content: "Return {\"status\":\"ok\"} and nothing else." },
  ],
});

console.log(JSON.stringify({
  connected: true,
  configuredModel: process.env.AZURE_FOUNDRY_MODEL,
  responseModel: response.model,
  responseId: response.responseId,
  usage: response.usage,
  content: response.content,
}, null, 2));

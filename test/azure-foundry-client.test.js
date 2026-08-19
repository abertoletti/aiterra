import assert from "node:assert/strict";
import test from "node:test";
import { AzureFoundryChatClient, AzureFoundryError } from "../src/agents/azure-foundry-client.js";

test("Azure Foundry client sends an authenticated OpenAI-compatible chat completion", async () => {
  let captured;
  const client = new AzureFoundryChatClient({
    endpoint: "https://foundry.example.test/chat/completions",
    credential: "test-secret",
    model: "deepseek-deployment",
    authMode: "api-key",
    apiVersion: "2025-04-01",
    maximumAttempts: 1,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return jsonResponse({
        id: "response-1", model: "deepseek-deployment",
        choices: [{ message: { content: "{\"status\":\"ok\"}" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    },
  });

  const result = await client.complete({ messages: [{ role: "user", content: "hello" }] });

  assert.match(captured.url, /api-version=2025-04-01/);
  assert.equal(captured.options.headers["api-key"], "test-secret");
  assert.equal(captured.options.headers.Authorization, undefined);
  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, "deepseek-deployment");
  assert.equal(body.max_completion_tokens, 700);
  assert.equal(result.content, "{\"status\":\"ok\"}");
  assert.equal(result.responseId, "response-1");
});

test("Azure Foundry client supports bearer endpoints and retries temporary throttling", async () => {
  let attempts = 0;
  const delays = [];
  const client = new AzureFoundryChatClient({
    endpoint: "https://managed.example.test/v1/chat/completions",
    credential: "azureml-token",
    model: "deepseek-ai/DeepSeek-V4-Flash",
    authMode: "bearer",
    maximumAttempts: 2,
    random: () => 0,
    delay: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async (_url, options) => {
      attempts += 1;
      assert.equal(options.headers.Authorization, "Bearer azureml-token");
      if (attempts === 1) return jsonResponse({ error: { code: "rate_limited", message: "wait" } }, 429, { "Retry-After": "0" });
      return jsonResponse({ choices: [{ message: { content: "done" } }] });
    },
  });

  const result = await client.complete({ messages: [{ role: "user", content: "hello" }] });

  assert.equal(attempts, 2);
  assert.deepEqual(delays, [0]);
  assert.equal(result.content, "done");
});

test("Azure Foundry client never exposes its credential in provider errors", async () => {
  const client = new AzureFoundryChatClient({
    endpoint: "https://foundry.example.test/chat/completions",
    credential: "sensitive-value",
    model: "deepseek-deployment",
    maximumAttempts: 1,
    fetchImpl: async () => jsonResponse({ error: { message: "rejected sensitive-value" } }, 401),
  });

  await assert.rejects(
    client.complete({ messages: [{ role: "user", content: "hello" }] }),
    (error) => error instanceof AzureFoundryError
      && error.status === 401
      && !error.message.includes("sensitive-value")
      && error.message.includes("[REDACTED]"),
  );
});

test("Azure Foundry client refuses placeholders and insecure remote endpoints", () => {
  assert.throws(() => new AzureFoundryChatClient({
    endpoint: "https://foundry.example.test/chat/completions", credential: "replace-me", model: "deployment",
  }), /placeholder/);
  assert.throws(() => new AzureFoundryChatClient({
    endpoint: "http://foundry.example.test/chat/completions", credential: "secret", model: "deployment",
  }), /must use HTTPS/);
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class AzureFoundryError extends Error {
  constructor(message, { code = "AZURE_FOUNDRY_ERROR", status = null, retryable = false, cause = null } = {}) {
    super(message, { cause });
    this.name = "AzureFoundryError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export class AzureFoundryChatClient {
  constructor({
    endpoint, credential, model, authMode = "api-key", apiVersion = null,
    maxCompletionTokens = 700, temperature = 0.5, requestTimeoutMs = 60_000,
    maximumAttempts = 3, fetchImpl = fetch, delay = defaultDelay, random = Math.random,
  }) {
    this.endpoint = normalizeEndpoint(endpoint, apiVersion);
    this.credential = requiredSecret(credential, "Azure Foundry credential");
    this.model = requiredText(model, "Azure Foundry model");
    if (!["api-key", "bearer"].includes(authMode)) {
      throw new Error("AZURE_FOUNDRY_AUTH_MODE must be api-key or bearer");
    }
    if (!Number.isInteger(maxCompletionTokens) || maxCompletionTokens < 1) {
      throw new Error("Azure Foundry max completion tokens must be a positive integer");
    }
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new Error("Azure Foundry temperature must be between 0 and 2");
    }
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
      throw new Error("Azure Foundry request timeout must be a positive integer");
    }
    if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 10) {
      throw new Error("Azure Foundry maximum attempts must be between 1 and 10");
    }
    this.authMode = authMode;
    this.maxCompletionTokens = maxCompletionTokens;
    this.temperature = temperature;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maximumAttempts = maximumAttempts;
    this.fetchImpl = fetchImpl;
    this.delay = delay;
    this.random = random;
  }

  async complete({ messages, signal = null }) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Azure Foundry messages must be a non-empty array");
    }

    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      let response;
      try {
        response = await fetchWithTimeout(this.fetchImpl, this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.authMode === "api-key"
              ? { "api-key": this.credential }
              : { Authorization: `Bearer ${this.credential}` }),
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_completion_tokens: this.maxCompletionTokens,
            temperature: this.temperature,
          }),
        }, this.requestTimeoutMs, signal);
      } catch (error) {
        const aborted = error?.name === "AbortError";
        const wrapped = new AzureFoundryError(
          aborted ? "Azure Foundry request was aborted or timed out" : "Azure Foundry request failed",
          { code: aborted ? "AZURE_FOUNDRY_TIMEOUT" : "AZURE_FOUNDRY_NETWORK_ERROR", retryable: !signal?.aborted, cause: error },
        );
        if (attempt === this.maximumAttempts || !wrapped.retryable) throw wrapped;
        await this.delay(backoffMilliseconds(attempt, null, this.random), signal);
        continue;
      }

      const payload = await readPayload(response);
      if (!response.ok) {
        const retryable = RETRYABLE_STATUS_CODES.has(response.status);
        const message = redact(
          payload?.error?.message ?? payload?.message ?? `Azure Foundry returned HTTP ${response.status}`,
          this.credential,
        );
        const error = new AzureFoundryError(message, {
          code: payload?.error?.code ?? payload?.code ?? "AZURE_FOUNDRY_HTTP_ERROR",
          status: response.status,
          retryable,
        });
        if (!retryable || attempt === this.maximumAttempts) throw error;
        await this.delay(backoffMilliseconds(attempt, response.headers.get("retry-after"), this.random), signal);
        continue;
      }

      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new AzureFoundryError("Azure Foundry response did not contain message content", {
          code: "AZURE_FOUNDRY_INVALID_RESPONSE",
        });
      }
      return {
        content: content.trim(),
        responseId: payload.id ?? null,
        model: payload.model ?? this.model,
        usage: payload.usage ?? null,
      };
    }
    throw new AzureFoundryError("Azure Foundry request exhausted all attempts");
  }
}

export function azureFoundryClientFromEnvironment(environment = process.env, overrides = {}) {
  return new AzureFoundryChatClient({
    endpoint: environment.AZURE_FOUNDRY_ENDPOINT,
    credential: environment.AZURE_FOUNDRY_API_KEY,
    model: environment.AZURE_FOUNDRY_MODEL,
    authMode: environment.AZURE_FOUNDRY_AUTH_MODE ?? "api-key",
    apiVersion: environment.AZURE_FOUNDRY_API_VERSION || null,
    maxCompletionTokens: integerEnvironment(environment, "AZURE_FOUNDRY_MAX_COMPLETION_TOKENS", 700),
    temperature: numberEnvironment(environment, "AZURE_FOUNDRY_TEMPERATURE", 0.5),
    requestTimeoutMs: integerEnvironment(environment, "AZURE_FOUNDRY_TIMEOUT_MS", 60_000),
    maximumAttempts: integerEnvironment(environment, "AZURE_FOUNDRY_MAXIMUM_ATTEMPTS", 3),
    ...overrides,
  });
}

function normalizeEndpoint(value, apiVersion) {
  const endpoint = requiredText(value, "AZURE_FOUNDRY_ENDPOINT");
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("AZURE_FOUNDRY_ENDPOINT must be an absolute URL");
  }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("AZURE_FOUNDRY_ENDPOINT must use HTTP or HTTPS");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("AZURE_FOUNDRY_ENDPOINT must use HTTPS unless it targets loopback");
  }
  if (apiVersion && !url.searchParams.has("api-version")) url.searchParams.set("api-version", apiVersion);
  return url.toString();
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function requiredSecret(value, label) {
  const secret = requiredText(value, label);
  if (["replace-me", "your-secret", "your-key"].includes(secret.toLowerCase())) {
    throw new Error(`${label} still contains a placeholder`);
  }
  return secret;
}

function integerEnvironment(environment, name, fallback) {
  if (!environment[name]) return fallback;
  const value = Number(environment[name]);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function numberEnvironment(environment, name, fallback) {
  if (!environment[name]) return fallback;
  const value = Number(environment[name]);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, externalSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("request timeout")), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 1_000) };
  }
}

function backoffMilliseconds(attempt, retryAfter, random) {
  const parsedRetryAfter = Number(retryAfter);
  if (Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 0) return Math.min(30_000, parsedRetryAfter * 1_000);
  const base = Math.min(10_000, 500 * (2 ** (attempt - 1)));
  return Math.round(base + base * 0.25 * random());
}

function defaultDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const timeout = setTimeout(() => finish(resolve), milliseconds);
    const abort = () => {
      finish(reject, signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function redact(message, secret) {
  return String(message).replaceAll(secret, "[REDACTED]").slice(0, 1_000);
}

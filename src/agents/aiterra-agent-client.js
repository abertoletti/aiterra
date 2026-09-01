export class AiterraProtocolError extends Error {
  constructor(message, { status = null, code = "AITERRA_PROTOCOL_ERROR", retryAfterSeconds = null } = {}) {
    super(message);
    this.name = "AiterraProtocolError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AiterraAgentClient {
  constructor({ baseUrl, characterId, token, fetchImpl = fetch }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.characterId = requiredText(characterId, "characterId");
    this.token = requiredText(token, `token for ${characterId}`);
    this.fetchImpl = fetchImpl;
  }

  observe({ signal = null, contextMode = "full", contextVersion = 0 } = {}) {
    const query = contextMode === "progressive"
      ? `?contextMode=progressive&contextVersion=${Number(contextVersion) || 0}`
      : "";
    return this.request(`/api/characters/${encodeURIComponent(this.characterId)}/observation${query}`, { signal });
  }

  // A decision-scoped catalog, requested only when the brain says the detail matters.
  inspect(resource, { filters = {}, limit = 20, offset = 0, signal = null } = {}) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    for (const [key, value] of Object.entries(filters)) query.set(key, String(value));
    return this.request(
      `/api/characters/${encodeURIComponent(this.characterId)}/context/${encodeURIComponent(resource)}?${query}`,
      { signal },
    );
  }

  // The manifest is stable for its version, so a runtime fetches it once per version.
  rules({ signal = null } = {}) {
    return this.request(`/api/characters/${encodeURIComponent(this.characterId)}/rules`, { signal });
  }

  history(limit = 40, { signal = null } = {}) {
    const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 40));
    return this.request(`/api/characters/${encodeURIComponent(this.characterId)}/history?limit=${boundedLimit}`, { signal })
      .then((body) => body.events);
  }

  // A resident-authored proposal goes in; authoritative costs and blockers come
  // back. This reserves nothing and is deliberately separate from construction.
  quoteBuilding(proposal, { signal = null } = {}) {
    return this.request(`/api/characters/${encodeURIComponent(this.characterId)}/building-quotes`, {
      method: "POST", signal, body: proposal,
    });
  }

  health({ signal = null } = {}) {
    return this.request(`/api/characters/${encodeURIComponent(this.characterId)}/agent/health`, {
      method: "POST",
      signal,
      body: {
        clientVersion: "aiterra-local-pilot/1",
        protocolVersion: "1.0",
        capabilities: ["observe", "act", "events", "ack"],
      },
    });
  }

  submitAction(action, expectedStateVersion, idempotencyKey, { signal = null } = {}) {
    return this.request(`/api/characters/${encodeURIComponent(this.characterId)}/actions`, {
      method: "POST",
      signal,
      headers: { "Idempotency-Key": requiredText(idempotencyKey, "idempotencyKey") },
      body: { ...action, expectedStateVersion },
    });
  }

  acknowledge(notificationEventId, { signal = null } = {}) {
    return this.request(
      `/api/characters/${encodeURIComponent(this.characterId)}/notifications/${encodeURIComponent(notificationEventId)}/ack`,
      { method: "POST", signal, body: {} },
    );
  }

  async streamEvents({ signal, onEvent, onOpen = null }) {
    if (typeof onEvent !== "function") throw new Error("onEvent callback is required");
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/characters/${encodeURIComponent(this.characterId)}/events`,
      { headers: this.authorizationHeaders(), signal },
    );
    if (!response.ok) throw await protocolError(response);
    if (!response.body) throw new AiterraProtocolError("Aiterra SSE response has no body", { code: "EMPTY_EVENT_STREAM" });
    await onOpen?.();
    await consumeSse(response.body, onEvent, signal);
  }

  async request(path, { method = "GET", headers = {}, body = null, signal = null } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...this.authorizationHeaders(),
        ...(body === null ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    if (!response.ok) throw await protocolError(response);
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  authorizationHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }
}

export async function consumeSse(stream, onEvent, signal = null) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = sseBoundary(buffer)) !== null) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const event = parseSseBlock(block);
        if (event) await onEvent(event);
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* The connection may already be closed. */ }
  }
}

export function parseSseBlock(block) {
  let eventName = "message";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  const rawData = data.join("\n");
  let parsedData = rawData;
  try { parsedData = JSON.parse(rawData); } catch { /* Text event data is valid SSE. */ }
  return { event: eventName, data: parsedData };
}

function sseBoundary(buffer) {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

async function protocolError(response) {
  let payload = null;
  try { payload = JSON.parse(await response.text()); } catch { /* Use the HTTP status below. */ }
  return new AiterraProtocolError(
    payload?.error?.message ?? `Aiterra returned HTTP ${response.status}`,
    {
      status: response.status,
      code: payload?.error?.code ?? "AITERRA_HTTP_ERROR",
      retryAfterSeconds: numberOrNull(response.headers.get("retry-after")),
    },
  );
}

function normalizeBaseUrl(value) {
  const text = requiredText(value, "AITERRA_BASE_URL").replace(/\/$/, "");
  try { return new URL(text).toString().replace(/\/$/, ""); } catch { throw new Error("AITERRA_BASE_URL must be an absolute URL"); }
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function numberOrNull(value) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { extname, join } from "node:path";
import { DomainError } from "./domain/world.js";

const staticFiles = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
]);

export function createHttpServer({
  world, agentTokens, ownerTokens = {}, ownerCharacters = {}, operatorToken = null,
  cursorSecret = "demo-owner-cursor-secret-change-me", publicDir,
}) {
  const streams = new Map();
  const rateLimits = new Map();

  const unsubscribe = world.subscribe((event) => {
    if (event.type !== "AGENT_NOTIFICATION_QUEUED") return;
    const recipients = streams.get(event.data.characterId) ?? new Set();
    if (recipients.size === 0) return;
    const envelope = world.markNotificationDelivered(event.data.characterId, event.id);
    for (const response of recipients) {
      try {
        writeSse(response, "relevant-event", envelope);
      } catch {
        world.markNotificationDeliveryFailed(event.data.characterId, event.id, "sse_write_failed");
      }
    }
  });

  const server = createNodeServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, {
          status: "ok", worldTime: world.clock.now().toISOString(), rulesVersion: world.config.rules.version,
        });
      }
      if (request.method === "GET" && url.pathname === "/api/timeline") {
        if (operatorToken) authorizeOperator(request, operatorToken);
        const characterId = url.searchParams.get("characterId") || undefined;
        return json(response, 200, { items: world.getTimeline({ characterId }) });
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        if (operatorToken) authorizeOperator(request, operatorToken);
        const publicState = world.getPublicState();
        const connectedCharacterIds = [...streams.entries()]
          .filter(([, connections]) => connections.size > 0)
          .map(([characterId]) => characterId);
        return json(response, 200, {
          ...publicState,
          runtime: {
            connectedCharacterIds,
            connectedAgentBrains: connectedCharacterIds.length,
            eventStreamConnections: [...streams.values()].reduce((total, connections) => total + connections.size, 0),
          },
        });
      }
      if (request.method === "GET" && url.pathname === "/api/metrics") {
        if (operatorToken) authorizeOperator(request, operatorToken);
        return json(response, 200, world.getProductMetrics({
          fromWorldTime: url.searchParams.get("from"),
          throughWorldTime: url.searchParams.get("through"),
          environment: url.searchParams.get("environment") ?? "development",
          isTest: url.searchParams.get("isTest") === "true",
          testRunId: url.searchParams.get("testRunId"),
        }));
      }

      let ownerMatch = url.pathname.match(/^\/api\/owners\/([^/]+)\/characters\/([^/]+)\/feed$/);
      if (request.method === "GET" && ownerMatch) {
        const ownerId = decodeURIComponent(ownerMatch[1]);
        const characterId = decodeURIComponent(ownerMatch[2]);
        authorizeOwner(request, ownerId, characterId, ownerTokens, ownerCharacters);
        const page = world.getOwnerFeed({
          ownerId, characterId, cursor: url.searchParams.get("cursor"),
          limit: Number(url.searchParams.get("limit") ?? world.config.ownerFeed.defaultPageSize),
          cursorSecret,
        });
        world.record("OWNER_FEED_VIEWED", {
          actorCharacterId: characterId,
          data: { ownerId, characterId, pageSize: page.items.length, paginated: Boolean(url.searchParams.get("cursor")) },
        });
        return json(response, 200, page);
      }

      ownerMatch = url.pathname.match(/^\/api\/owners\/([^/]+)\/characters\/([^/]+)\/return-summary$/);
      if (request.method === "GET" && ownerMatch) {
        const ownerId = decodeURIComponent(ownerMatch[1]);
        const characterId = decodeURIComponent(ownerMatch[2]);
        authorizeOwner(request, ownerId, characterId, ownerTokens, ownerCharacters);
        const defaultSince = new Date(world.clock.now().getTime() - 24 * 60 * 60_000).toISOString();
        const summary = world.createReturnSummary({
          ownerId, characterId,
          sinceWorldTime: url.searchParams.get("since") ?? defaultSince,
          throughWorldTime: url.searchParams.get("through") ?? world.clock.now(),
        });
        return json(response, 200, world.viewReturnSummary(ownerId, characterId, summary.id));
      }

      ownerMatch = url.pathname.match(/^\/api\/owners\/([^/]+)\/characters\/([^/]+)\/story-details\/([^/]+)$/);
      if (request.method === "GET" && ownerMatch) {
        const ownerId = decodeURIComponent(ownerMatch[1]);
        const characterId = decodeURIComponent(ownerMatch[2]);
        const eventId = decodeURIComponent(ownerMatch[3]);
        authorizeOwner(request, ownerId, characterId, ownerTokens, ownerCharacters);
        return json(response, 200, world.viewStoryDetail(ownerId, characterId, eventId));
      }

      ownerMatch = url.pathname.match(/^\/api\/owners\/([^/]+)\/characters\/([^/]+)\/story-details\/([^/]+)\/rating$/);
      if (request.method === "POST" && ownerMatch) {
        const ownerId = decodeURIComponent(ownerMatch[1]);
        const characterId = decodeURIComponent(ownerMatch[2]);
        const eventId = decodeURIComponent(ownerMatch[3]);
        authorizeOwner(request, ownerId, characterId, ownerTokens, ownerCharacters);
        const body = await readJson(request, world.config.protocol.requestBodyLimitBytes);
        const event = world.rateStory(ownerId, characterId, eventId, body.rating);
        return json(response, 201, { accepted: true, eventId: event.id, rating: event.data.rating });
      }

      ownerMatch = url.pathname.match(/^\/api\/owners\/([^/]+)\/characters\/([^/]+)\/agent-credentials$/);
      if (request.method === "POST" && ownerMatch) {
        const ownerId = decodeURIComponent(ownerMatch[1]);
        const characterId = decodeURIComponent(ownerMatch[2]);
        authorizeOwner(request, ownerId, characterId, ownerTokens, ownerCharacters);
        const body = await readJson(request, world.config.protocol.requestBodyLimitBytes);
        return json(response, 201, world.issueAgentCredential(characterId, body.permissions));
      }

      ownerMatch = url.pathname.match(/^\/api\/owners\/([^/]+)\/characters\/([^/]+)\/agent-credentials\/([^/]+)$/);
      if (request.method === "DELETE" && ownerMatch) {
        const ownerId = decodeURIComponent(ownerMatch[1]);
        const characterId = decodeURIComponent(ownerMatch[2]);
        const credentialId = decodeURIComponent(ownerMatch[3]);
        authorizeOwner(request, ownerId, characterId, ownerTokens, ownerCharacters);
        const event = world.revokeAgentCredential(characterId, credentialId);
        return json(response, 200, { revoked: true, eventId: event?.id ?? null });
      }

      ownerMatch = url.pathname.match(/^\/api\/owners\/([^/]+)\/characters\/([^/]+)\/agent-event-channel$/);
      if (request.method === "POST" && ownerMatch) {
        const ownerId = decodeURIComponent(ownerMatch[1]);
        const characterId = decodeURIComponent(ownerMatch[2]);
        authorizeOwner(request, ownerId, characterId, ownerTokens, ownerCharacters);
        const body = await readJson(request, world.config.protocol.requestBodyLimitBytes);
        return json(response, 201, world.registerAgentEventChannel(characterId, body));
      }

      ownerMatch = url.pathname.match(/^\/api\/owners\/([^/]+)\/characters\/([^/]+)\/agent-event-channel\/([^/]+)$/);
      if (request.method === "DELETE" && ownerMatch) {
        const ownerId = decodeURIComponent(ownerMatch[1]);
        const characterId = decodeURIComponent(ownerMatch[2]);
        const channelId = decodeURIComponent(ownerMatch[3]);
        authorizeOwner(request, ownerId, characterId, ownerTokens, ownerCharacters);
        const event = world.disableAgentEventChannel(characterId, channelId);
        return json(response, 200, { disabled: true, eventId: event?.id ?? null });
      }

      let match = url.pathname.match(/^\/api\/characters\/([^/]+)\/observation$/);
      if (request.method === "GET" && match) {
        const characterId = decodeURIComponent(match[1]);
        authorizeAndLimit(request, characterId, "observe", agentTokens, rateLimits, world);
        const contextOptions = {
          contextMode: url.searchParams.get("contextMode") ?? "full",
          contextVersion: Number(url.searchParams.get("contextVersion") ?? 0),
        };
        let observation = world.getObservation(characterId, contextOptions);
        // In progressive mode the catalogs are not shipped, so an unrequested
        // observation must not claim the character viewed them.
        if (observation.availableJobs?.length > 0 || observation.upcomingEvents?.length > 0) {
          const viewed = world.recordOpportunitiesViewed(
            characterId,
            observation.availableJobs.map((job) => job.id),
            observation.upcomingEvents.map((event) => event.id),
          );
          if (viewed.recorded) observation = world.getObservation(characterId, contextOptions);
        }
        return json(response, 200, observation);
      }

      match = url.pathname.match(/^\/api\/characters\/([^/]+)\/context\/([^/]+)$/);
      if (request.method === "GET" && match) {
        const characterId = decodeURIComponent(match[1]);
        const resource = decodeURIComponent(match[2]);
        authorizeAndLimit(request, characterId, "observe", agentTokens, rateLimits, world);
        const filters = {};
        for (const [key, value] of url.searchParams) {
          if (key === "limit" || key === "offset" || key === "decisionCycleId") continue;
          filters[key] = value;
        }
        return json(response, 200, world.inspectContext(characterId, {
          resource,
          filters,
          limit: Number(url.searchParams.get("limit") ?? 20),
          offset: Number(url.searchParams.get("offset") ?? 0),
          decisionCycleId: url.searchParams.get("decisionCycleId") ?? undefined,
        }));
      }

      match = url.pathname.match(/^\/api\/characters\/([^/]+)\/rules$/);
      if (request.method === "GET" && match) {
        const characterId = decodeURIComponent(match[1]);
        authorizeAndLimit(request, characterId, "observe", agentTokens, rateLimits, world);
        const manifest = world.getAgentRules(characterId);
        world.recordAgentRulesRequested(characterId, manifest);
        return json(response, 200, manifest);
      }

      match = url.pathname.match(/^\/api\/characters\/([^/]+)\/history$/);
      if (request.method === "GET" && match) {
        const characterId = decodeURIComponent(match[1]);
        authorizeAndLimit(request, characterId, "observe", agentTokens, rateLimits, world);
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));
        return json(response, 200, { events: world.getCharacterHistory(characterId, limit) });
      }

      match = url.pathname.match(/^\/api\/characters\/([^/]+)\/building-quotes$/);
      if (request.method === "POST" && match) {
        const characterId = decodeURIComponent(match[1]);
        authorizeAndLimit(request, characterId, "observe", agentTokens, rateLimits, world);
        const proposal = await readJson(request, world.config.protocol.requestBodyLimitBytes);
        return json(response, 200, world.quoteBuildingProposal(characterId, proposal));
      }

      match = url.pathname.match(/^\/api\/characters\/([^/]+)\/actions$/);
      if (request.method === "POST" && match) {
        const characterId = decodeURIComponent(match[1]);
        authorizeAndLimit(request, characterId, "act", agentTokens, rateLimits, world);
        const action = await readJson(request, world.config.protocol.requestBodyLimitBytes);
        const idempotencyKey = request.headers["idempotency-key"];
        if (world.config.protocol.requireIdempotencyKey && !idempotencyKey) {
          throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for agent actions", 400);
        }
        if (idempotencyKey && (typeof idempotencyKey !== "string" || idempotencyKey.length > 100)) {
          throw new DomainError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be at most 100 characters", 400);
        }
        if (world.config.protocol.requireExpectedStateVersion && action.expectedStateVersion === undefined) {
          throw new DomainError("STATE_VERSION_REQUIRED", "expectedStateVersion is required for agent actions", 400);
        }
        return json(response, 202, world.executeAgentAction(characterId, action, idempotencyKey));
      }

      match = url.pathname.match(/^\/api\/characters\/([^/]+)\/notifications\/([^/]+)\/ack$/);
      if (request.method === "POST" && match) {
        const characterId = decodeURIComponent(match[1]);
        const notificationId = decodeURIComponent(match[2]);
        authorizeAndLimit(request, characterId, "ack", agentTokens, rateLimits, world);
        const event = world.acknowledgeNotification(characterId, notificationId);
        return json(response, 200, { acknowledged: true, eventId: event.id });
      }

      match = url.pathname.match(/^\/api\/characters\/([^/]+)\/agent\/health$/);
      if (request.method === "POST" && match) {
        const characterId = decodeURIComponent(match[1]);
        authorizeAndLimit(request, characterId, "health", agentTokens, rateLimits, world);
        const body = await readJson(request, world.config.protocol.requestBodyLimitBytes);
        return json(response, 200, world.testAgentConnection(characterId, body));
      }

      match = url.pathname.match(/^\/api\/characters\/([^/]+)\/agent-event-channel\/([^/]+)\/verify$/);
      if (request.method === "POST" && match) {
        const characterId = decodeURIComponent(match[1]);
        const channelId = decodeURIComponent(match[2]);
        authorizeAndLimit(request, characterId, "events", agentTokens, rateLimits, world);
        const body = await readJson(request, world.config.protocol.requestBodyLimitBytes);
        const event = world.verifyAgentEventChannel(characterId, channelId, body.verificationToken);
        return json(response, 200, { verified: true, eventId: event?.id ?? null });
      }

      match = url.pathname.match(/^\/api\/characters\/([^/]+)\/events$/);
      if (request.method === "GET" && match) {
        const characterId = decodeURIComponent(match[1]);
        authorizeAndLimit(request, characterId, "events", agentTokens, rateLimits, world);
        if ((world.config.protocol.requireVerifiedEventChannel || world.hasConfiguredAgentEventChannel(characterId))
          && !world.hasVerifiedAgentEventChannel(characterId)) {
          throw new DomainError("AGENT_CHANNEL_NOT_VERIFIED", "A verified agent event channel is required", 409);
        }
        if ((streams.get(characterId)?.size ?? 0) >= world.config.protocol.maxSseConnectionsPerCharacter) {
          throw new DomainError("CONNECTION_LIMIT_REACHED", "Character event-channel connection limit reached", 429);
        }
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write("retry: 3000\n\n");
        if (!streams.has(characterId)) streams.set(characterId, new Set());
        streams.get(characterId).add(response);
        for (const event of world.getPendingNotificationEvents(characterId)) {
          if (world.getNotificationEnvelope(event.id).deliveredAt) world.recordAgentEventReplay(characterId, event.id);
          const envelope = world.markNotificationDelivered(characterId, event.id);
          try {
            writeSse(response, "relevant-event", envelope);
          } catch {
            world.markNotificationDeliveryFailed(characterId, event.id, "sse_replay_write_failed");
          }
        }
        const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 20_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          streams.get(characterId)?.delete(response);
        });
        return;
      }

      if (request.method === "GET" && staticFiles.has(url.pathname)) {
        return serveStatic(response, join(publicDir, staticFiles.get(url.pathname)));
      }
      return json(response, 404, { error: { code: "NOT_FOUND", message: "Route not found" } });
    } catch (error) {
      const status = error instanceof DomainError ? error.status : 500;
      if (status === 500) console.error(error);
      if (!response.headersSent) {
        if (error.retryAfterSeconds) response.setHeader("Retry-After", String(error.retryAfterSeconds));
        return json(response, status, {
          error: {
            code: error.code ?? "INTERNAL_ERROR",
            message: status === 500 ? "Internal server error" : error.message,
            ...(error instanceof DomainError && error.details ? { details: error.details } : {}),
          },
        });
      }
      response.end();
    }
  });

  server.on("close", unsubscribe);
  return server;
}

function authorizeAndLimit(request, characterId, permission, agentTokens, rateLimits, world) {
  const expected = agentTokens[characterId];
  const header = request.headers.authorization;
  const supplied = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  const staticCredentialAccepted = expected && safeEqual(expected, supplied);
  const issuedCredentialAccepted = world.authenticateAgentCredential(characterId, supplied, permission);
  if (!staticCredentialAccepted && !issuedCredentialAccepted) throw new DomainError("UNAUTHORIZED", "Invalid character agent credentials", 401);

  const now = Date.now();
  const key = `${characterId}:${permission}`;
  const current = rateLimits.get(key);
  if (!current || now - current.startedAt >= world.config.protocol.rateLimitWindowMs) {
    rateLimits.set(key, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
    if (current.count > world.config.protocol.rateLimitRequests) {
      const error = new DomainError("RATE_LIMITED", `Agent ${permission} request rate exceeded`, 429);
      error.retryAfterSeconds = Math.max(1, Math.ceil((world.config.protocol.rateLimitWindowMs - (now - current.startedAt)) / 1_000));
      throw error;
    }
  }
}

function authorizeOwner(request, ownerId, characterId, ownerTokens, ownerCharacters) {
  const expected = ownerTokens[ownerId];
  const header = request.headers.authorization;
  const supplied = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !safeEqual(expected, supplied)) throw new DomainError("UNAUTHORIZED", "Invalid owner credentials", 401);
  if (!(ownerCharacters[ownerId] ?? []).includes(characterId)) {
    throw new DomainError("OWNER_SCOPE_MISMATCH", "Owner is not authorized for this character", 403);
  }
}

function authorizeOperator(request, operatorToken) {
  const header = request.headers.authorization;
  const supplied = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(operatorToken, supplied)) throw new DomainError("UNAUTHORIZED", "Invalid operator credentials", 401);
}

function safeEqual(expected, supplied) {
  const left = createHash("sha256").update(String(expected)).digest();
  const right = createHash("sha256").update(String(supplied)).digest();
  return timingSafeEqual(left, right);
}

async function readJson(request, limit) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new DomainError("BODY_TOO_LARGE", "Request body is too large", 413);
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new DomainError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'");
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function writeSse(response, eventName, payload) {
  response.write(`id: ${payload.id}\nevent: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function serveStatic(response, filePath) {
  const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" }[extname(filePath)];
  const stat = statSync(filePath);
  response.writeHead(200, { "Content-Type": mime, "Content-Length": stat.size, "Cache-Control": "no-cache" });
  createReadStream(filePath).pipe(response);
}

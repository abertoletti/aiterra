import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";
import { createHttpServer } from "../src/server.js";

test("the protocol authenticates character-scoped observation and validates actions", async (t) => {
  const { world, server, baseUrl } = await protocolWorld();
  t.after(() => close(server));

  const unauthorized = await fetch(`${baseUrl}/api/characters/jack/observation`);
  assert.equal(unauthorized.status, 401);

  const observation = await fetch(`${baseUrl}/api/characters/jack/observation`, {
    headers: { Authorization: "Bearer jack-secret" },
  });
  assert.equal(observation.status, 200);
  const body = await observation.json();
  assert.equal(body.character.id, "jack");
  assert.equal(body.nearby.length, 0);
  assert.equal(body.world, undefined, "observation does not expose global state");
  assert.equal(body.rulesVersion, "agent-rules-v11");

  const rulesResponse = await fetch(`${baseUrl}/api/characters/jack/rules`, {
    headers: { Authorization: "Bearer jack-secret" },
  });
  assert.equal(rulesResponse.status, 200);
  const rules = await rulesResponse.json();
  assert.equal(rules.version, "agent-rules-v11");
  assert.equal(rules.conversations.maximumTurns, 8);
  assert.ok(world.history.some((event) => event.type === "AGENT_RULES_REQUESTED"
    && event.data.characterId === "jack" && event.data.manifestBytes > 0));

  const manipulation = await fetch(`${baseUrl}/api/characters/jack/actions`, {
    method: "POST",
    headers: {
      Authorization: "Bearer jack-secret", "Content-Type": "application/json",
      "Idempotency-Key": "invalid-manipulation",
    },
    body: JSON.stringify({ type: "set_credits", amount: 1_000_000, expectedStateVersion: body.stateVersion }),
  });
  assert.equal(manipulation.status, 422);
  assert.equal(world.getObservation("jack").character.credits, 100);

  const leakedState = await fetch(`${baseUrl}/api/state`, {
    headers: { Authorization: "Bearer jack-secret" },
  });
  assert.equal(leakedState.status, 401, "an agent credential cannot read operator state");
});

test("the building quote endpoint returns mechanics without reserving or constructing", async (t) => {
  const { world, server, baseUrl } = await protocolWorld();
  t.after(() => close(server));
  const projectionBefore = world.characterStateVersion("jack");

  const response = await fetch(`${baseUrl}/api/characters/jack/building-quotes`, {
    method: "POST",
    headers: { Authorization: "Bearer jack-secret", "Content-Type": "application/json" },
    body: JSON.stringify({
      x: 1, y: 1, width: 1, height: 1,
      name: "Jack's Idea", description: "A proposal only.",
      profile: { music: 10 }, capabilities: ["host_event"],
    }),
  });
  assert.equal(response.status, 200);
  const quote = await response.json();
  assert.equal(quote.constructionCost, 203);
  assert.equal(quote.availableCredits, 100);
  assert.equal(quote.creditsAfterConstruction, -103);
  assert.deepEqual(quote.feasibility.blockingCodes, ["INSUFFICIENT_CREDITS"]);
  assert.equal(world.state.buildings.size, 0);
  assert.equal(world.characterStateVersion("jack"), projectionBefore);
  assert.ok(world.history.some((event) => event.type === "BUILDING_QUOTE_REQUESTED"));
});

test("SSE replays a pending high-relevance wake-up to the controlling brain", async (t) => {
  const { world, clock, server, baseUrl } = await protocolWorld();
  t.after(() => close(server));
  world.establishRelationship({ fromId: "jack", toId: "sara", value: 70 });
  world.startMove("sara", "neon");
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  assert.equal(world.getPendingNotificationEvents("jack").length, 1);

  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${baseUrl}/api/characters/jack/events`, {
    headers: { Authorization: "Bearer jack-secret" }, signal: controller.signal,
  });
  assert.equal(response.status, 200);

  const reader = response.body.getReader();
  const liveStateResponse = await fetch(`${baseUrl}/api/state`, {
    headers: { Authorization: "Bearer operator-secret" },
  });
  const liveState = await liveStateResponse.json();
  assert.equal(liveState.runtime.connectedAgentBrains, 1);
  assert.deepEqual(liveState.runtime.connectedCharacterIds, ["jack"]);
  let received = "";
  for (let attempt = 0; attempt < 4 && !received.includes("event: relevant-event"); attempt += 1) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += new TextDecoder().decode(chunk.value);
  }
  controller.abort();
  assert.match(received, /event: relevant-event/);
  assert.match(received, /Sara arrived at your location/);
  assert.match(received, /"level":"HIGH"/);
  controller.abort();

  const replayController = new AbortController();
  t.after(() => replayController.abort());
  const replay = await fetch(`${baseUrl}/api/characters/jack/events`, {
    headers: { Authorization: "Bearer jack-secret" }, signal: replayController.signal,
  });
  assert.equal(replay.status, 200);
  const replayReader = replay.body.getReader();
  let replayed = "";
  for (let attempt = 0; attempt < 4 && !replayed.includes("event: relevant-event"); attempt += 1) {
    const chunk = await replayReader.read();
    if (chunk.done) break;
    replayed += new TextDecoder().decode(chunk.value);
  }
  replayController.abort();
  assert.match(replayed, /event: relevant-event/);
  assert.ok(world.history.some((event) => event.type === "AGENT_EVENT_REPLAYED"
    && event.data.notificationEventId === world.getPendingNotificationEvents("jack")[0].id));
});

test("the action protocol requires idempotency and rejects stale character projections", async (t) => {
  const { world, server, baseUrl } = await protocolWorld();
  t.after(() => close(server));
  const observationResponse = await fetch(`${baseUrl}/api/characters/jack/observation`, {
    headers: { Authorization: "Bearer jack-secret" },
  });
  const observation = await observationResponse.json();
  const missingKey = await fetch(`${baseUrl}/api/characters/jack/actions`, {
    method: "POST",
    headers: { Authorization: "Bearer jack-secret", "Content-Type": "application/json" },
    body: JSON.stringify({ type: "move", destinationId: "home", expectedStateVersion: observation.stateVersion }),
  });
  assert.equal(missingKey.status, 400);
  assert.equal((await missingKey.json()).error.code, "IDEMPOTENCY_KEY_REQUIRED");

  world.changeEnergy("jack", -1, "external_world_change");
  const stale = await fetch(`${baseUrl}/api/characters/jack/actions`, {
    method: "POST",
    headers: {
      Authorization: "Bearer jack-secret", "Content-Type": "application/json",
      "Idempotency-Key": "stale-action",
    },
    body: JSON.stringify({ type: "move", destinationId: "home", expectedStateVersion: observation.stateVersion }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "STALE_STATE_VERSION");
});

test("an owner can issue a permission-scoped credential shown once and revoke it", async (t) => {
  const { world, server, baseUrl } = await protocolWorld();
  t.after(() => close(server));
  const ownerHeaders = { Authorization: "Bearer jack-owner-secret", "Content-Type": "application/json" };
  const issuedResponse = await fetch(`${baseUrl}/api/owners/owner-jack/characters/jack/agent-credentials`, {
    method: "POST", headers: ownerHeaders,
    body: JSON.stringify({ permissions: ["observe"] }),
  });
  assert.equal(issuedResponse.status, 201);
  const issued = await issuedResponse.json();
  assert.ok(issued.token.length >= 32);
  assert.ok(!JSON.stringify(world.history).includes(issued.token), "the full token is never persisted in the world log");

  const observation = await fetch(`${baseUrl}/api/characters/jack/observation`, {
    headers: { Authorization: `Bearer ${issued.token}` },
  });
  assert.equal(observation.status, 200);
  const forbiddenAction = await fetch(`${baseUrl}/api/characters/jack/actions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${issued.token}`, "Content-Type": "application/json",
      "Idempotency-Key": "permission-test",
    },
    body: JSON.stringify({ type: "move", destinationId: "home", expectedStateVersion: world.characterStateVersion("jack") }),
  });
  assert.equal(forbiddenAction.status, 401);

  const revoked = await fetch(`${baseUrl}/api/owners/owner-jack/characters/jack/agent-credentials/${issued.credentialId}`, {
    method: "DELETE", headers: ownerHeaders,
  });
  assert.equal(revoked.status, 200);
  const afterRevocation = await fetch(`${baseUrl}/api/characters/jack/observation`, {
    headers: { Authorization: `Bearer ${issued.token}` },
  });
  assert.equal(afterRevocation.status, 401);
});

test("event channels require owner registration and runtime verification, and can be replaced", async (t) => {
  const { server, baseUrl } = await protocolWorld();
  t.after(() => close(server));
  const ownerHeaders = { Authorization: "Bearer jack-owner-secret", "Content-Type": "application/json" };
  const agentHeaders = { Authorization: "Bearer jack-secret", "Content-Type": "application/json" };
  const registeredResponse = await fetch(`${baseUrl}/api/owners/owner-jack/characters/jack/agent-event-channel`, {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ channelId: "jack-channel-1", transport: "sse" }),
  });
  assert.equal(registeredResponse.status, 201);
  const registered = await registeredResponse.json();

  const pendingChannel = await fetch(`${baseUrl}/api/characters/jack/events`, { headers: agentHeaders });
  assert.equal(pendingChannel.status, 409);
  const verification = await fetch(`${baseUrl}/api/characters/jack/agent-event-channel/${registered.channelId}/verify`, {
    method: "POST", headers: agentHeaders, body: JSON.stringify({ verificationToken: registered.verificationToken }),
  });
  assert.equal(verification.status, 200);

  const controller = new AbortController();
  const verifiedChannel = await fetch(`${baseUrl}/api/characters/jack/events`, {
    headers: agentHeaders, signal: controller.signal,
  });
  assert.equal(verifiedChannel.status, 200);
  controller.abort();

  const replacementResponse = await fetch(`${baseUrl}/api/owners/owner-jack/characters/jack/agent-event-channel`, {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ channelId: "jack-channel-2", transport: "sse" }),
  });
  assert.equal(replacementResponse.status, 201);
  const replacement = await replacementResponse.json();
  const replacementPending = await fetch(`${baseUrl}/api/characters/jack/events`, { headers: agentHeaders });
  assert.equal(replacementPending.status, 409);
  assert.notEqual(replacement.verificationToken, registered.verificationToken);
});

test("connection testing reports actionable compatibility problems without mechanical mutation", async (t) => {
  const { world, server, baseUrl } = await protocolWorld();
  t.after(() => close(server));
  const before = world.getObservation("jack").character;
  const incompatible = await fetch(`${baseUrl}/api/characters/jack/agent/health`, {
    method: "POST",
    headers: { Authorization: "Bearer jack-secret", "Content-Type": "application/json" },
    body: JSON.stringify({ clientVersion: "reference/1", protocolVersion: "0.9", capabilities: ["observe"] }),
  });
  assert.equal(incompatible.status, 200);
  const incompatibleBody = await incompatible.json();
  assert.equal(incompatibleBody.compatible, false);
  assert.ok(incompatibleBody.problems.some((problem) => problem.code === "PROTOCOL_VERSION_MISMATCH"));
  assert.deepEqual(world.getObservation("jack").character, before);

  const compatible = await fetch(`${baseUrl}/api/characters/jack/agent/health`, {
    method: "POST",
    headers: { Authorization: "Bearer jack-secret", "Content-Type": "application/json" },
    body: JSON.stringify({
      clientVersion: "reference/1", protocolVersion: "1.0",
      capabilities: ["observe", "act", "events", "ack"],
    }),
  });
  assert.equal(compatible.status, 200);
  const compatibleBody = await compatible.json();
  assert.equal(compatibleBody.compatible, true);
  assert.equal(compatibleBody.rulesVersion, "agent-rules-v11");
  assert.equal(compatibleBody.rulesUrl, "/api/characters/jack/rules");
});

async function protocolWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  let id = 1;
  const world = new World({ store: new InMemoryEventStore(), config, clock, idGenerator: () => `event-${id++}` });
  world.defineLocation({ id: "home", name: "Home" });
  world.defineLocation({ id: "neon", name: "Neon Club" });
  world.createCharacter({ id: "jack", name: "Jack", locationId: "neon", credits: 100 });
  world.createCharacter({ id: "sara", name: "Sara", locationId: "home", credits: 100 });
  const server = createHttpServer({
    world,
    agentTokens: { jack: "jack-secret", sara: "sara-secret" },
    ownerTokens: { "owner-jack": "jack-owner-secret", "owner-sara": "sara-owner-secret" },
    ownerCharacters: { "owner-jack": ["jack"], "owner-sara": ["sara"] },
    operatorToken: "operator-secret",
    publicDir: resolve("public"),
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return { world, clock, server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function close(server) {
  return new Promise((resolveClose) => server.close(resolveClose));
}

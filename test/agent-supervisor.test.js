import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { AgentSupervisor, SlidingWindowRateLimiter } from "../src/agents/agent-supervisor.js";
import { AiterraAgentClient } from "../src/agents/aiterra-agent-client.js";
import { DecisionValidationError } from "../src/agents/decision-planner.js";
import { loadWorldConfiguration, activateWorldConfiguration } from "../src/config/world-configuration.js";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";
import { createHttpServer } from "../src/server.js";

test("five isolated agent workers use the public protocol for conversation, relationship, and jobs", async (t) => {
  const clock = new ManualClock("2042-06-01T18:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config: makeConfig(), clock });
  const integrationConfiguration = loadWorldConfiguration(resolve("config/world.local-5.json"));
  integrationConfiguration.version = "five-agent-protocol-integration-test";
  integrationConfiguration.characters = integrationConfiguration.characters.filter((character) => Number(character.id.slice(-2)) <= 5);
  const integrationLocations = {
    "pilot-01": "market", "pilot-02": "market", "pilot-03": "market", "pilot-04": "foundry", "pilot-05": "foundry",
  };
  for (const character of integrationConfiguration.characters) {
    character.locationId = integrationLocations[character.id];
    if (character.id === "pilot-04") character.skills.technical = 80;
  }
  activateWorldConfiguration(world, integrationConfiguration);
  const characterIds = ["pilot-01", "pilot-02", "pilot-03", "pilot-04", "pilot-05"];
  const tokens = Object.fromEntries(characterIds.map((id) => [id, `${id}-test-secret`]));
  const server = createHttpServer({ world, agentTokens: tokens, publicDir: resolve("public") });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const planner = new ScriptedPilotPlanner();
  const agents = characterIds.map((characterId) => ({
    characterId,
    client: new AiterraAgentClient({ baseUrl, characterId, token: tokens[characterId] }),
  }));
  const supervisor = new AgentSupervisor({
    agents, planner, concurrency: 2, pollIntervalMs: 50, decisionCooldownMs: 1,
    maximumActionsPerCycle: 3, modelCallsPerWindow: 50, modelCallWindowMs: 1_000, reconnectDelayMs: 10,
    logger: { warn() {}, error() {}, log() {} },
  });
  t.after(async () => {
    await supervisor.stop();
    await new Promise((resolveClose) => server.close(resolveClose));
  });

  await supervisor.start();
  await waitFor(() => world.history.some((event) => event.type === "CONVERSATION_ENDED")
    && world.history.some((event) => event.type === "RELATIONSHIP_CHANGED")
    && world.history.filter((event) => event.type === "JOB_STARTED").length >= 3, 5_000);
  await supervisor.stop();

  const report = supervisor.report();
  assert.deepEqual(Object.keys(report.agents), characterIds);
  assert.ok(report.agents["pilot-01"].actionsByType.start_conversation >= 1);
  assert.ok(report.agents["pilot-02"].actionsByType.send_message >= 1);
  assert.ok(report.agents["pilot-01"].actionsByType.appraise_interaction >= 1);
  assert.ok(report.agents["pilot-01"].receivedEvents >= 1);
  assert.ok(report.agents["pilot-02"].receivedEvents >= 1);
  assert.ok(report.agents["pilot-01"].acknowledgedNotifications >= 1);
  assert.ok(report.agents["pilot-02"].acknowledgedNotifications >= 1);
  assert.equal(report.agents["pilot-01"].staleRetries, 0, "notification acknowledgement refreshes state before deciding");
  assert.equal(report.agents["pilot-02"].staleRetries, 0, "notification acknowledgement refreshes state before deciding");
  assert.equal(report.socialEnergy.conversationEnergySpent, 3);
  assert.equal(report.socialEnergy.conversationsStarted, 1);
  assert.equal(report.socialEnergy.averageEnergyPerStartedConversation, 3);
  assert.equal(report.socialEnergy.interactionsRejectedForEnergy, 0);
  for (const characterId of ["pilot-03", "pilot-04", "pilot-05"]) {
    assert.equal(report.agents[characterId].actionsByType.accept_job, 1);
    assert.equal(report.agents[characterId].actionsByType.start_job, 1);
  }
  assert.equal(world.history.filter((event) => event.type === "AGENT_CONNECTION_TESTED").length, 5);
});

test("model call limits replenish independently after their temporal window", async () => {
  let now = 0;
  const waits = [];
  const limiter = new SlidingWindowRateLimiter(2, 60_000, {
    now: () => now,
    delay: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; },
  });

  assert.equal(await limiter.waitForAvailability(), 0);
  limiter.consume();
  assert.equal(await limiter.waitForAvailability(), 0);
  limiter.consume();
  assert.equal(await limiter.waitForAvailability(), 60_000);
  limiter.consume();
  assert.deepEqual(waits, [60_000]);
});

test("pilot shutdown assigns one participant to close each active conversation", async () => {
  const submitted = [];
  const conversation = { id: "conversation-1", participantIds: ["pilot-02", "pilot-01"], messages: [] };
  const makeClient = (characterId, stateVersion) => ({
    async observe() {
      return { character: { id: characterId, name: characterId }, stateVersion, activeConversations: [conversation] };
    },
    async submitAction(action, expectedStateVersion, idempotencyKey) {
      submitted.push({ characterId, action, expectedStateVersion, idempotencyKey });
      return { accepted: true };
    },
  });
  const supervisor = new AgentSupervisor({
    agents: [
      { characterId: "pilot-01", client: makeClient("pilot-01", 7) },
      { characterId: "pilot-02", client: makeClient("pilot-02", 9) },
    ],
    planner: { async decide() { return { action: { type: "remain_silent" } }; } },
    logger: { warn() {}, error() {}, log() {} },
  });

  await supervisor.closeActiveConversations();

  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0].action, { type: "end_conversation", conversationId: "conversation-1" });
  assert.equal(submitted[0].characterId, "pilot-01");
  assert.equal(submitted[0].expectedStateVersion, 7);
  assert.equal(supervisor.report().agents["pilot-01"].gracefulConversationClosures, 1);
});

class ScriptedPilotPlanner {
  async decide({ observation }) {
    const id = observation.character.id;
    const actions = observation.availableActions;
    const pendingConversation = observation.pendingNotifications.find((item) =>
      item.eventId === observation.decision.notificationEventId && item.requestKind === "conversation_response");
    if (pendingConversation && id === "pilot-02") {
      return { action: {
        type: "send_message", conversationId: pendingConversation.conversationId,
        text: "Yes. Let us compare what the community needs before choosing work.", sharedFacts: [],
      } };
    }
    if (pendingConversation && id === "pilot-01") {
      // A co-present person's directional relationship rides in `nearby` in both
      // context modes; the full `relationships` list only ships in full mode.
      const relationship = observation.relationships?.find((item) => item.characterId === "pilot-02")
        ?? observation.nearby.find((item) => item.id === "pilot-02")?.relationship;
      const appraisal = actions.find((item) => item.type === "appraise_interaction" && item.otherCharacterId === "pilot-02");
      if (appraisal && relationship?.affinity === 0) {
        return { action: {
          type: "appraise_interaction", conversationId: appraisal.conversationId,
          otherCharacterId: "pilot-02", interactionKind: "interaction", appraisal: "appreciated",
        } };
      }
      return { action: { type: "end_conversation", conversationId: pendingConversation.conversationId } };
    }
    if (id === "pilot-01") {
      const start = actions.find((item) => item.type === "start_conversation" && item.targetCharacterId === "pilot-02");
      if (start) return { action: { ...start, openingMessage: "Hello Jonas. What work would help this place most today?" } };
    }
    if (id === "pilot-02") throw new DecisionValidationError("Wait for Mira to start the intended test conversation");

    const jobByCharacter = {
      "pilot-03": "festival-signs", "pilot-04": "repair-benches", "pilot-05": "workshop-coordinator",
    };
    const jobId = jobByCharacter[id];
    const startJob = actions.find((item) => item.type === "start_job" && item.jobId === jobId);
    if (startJob) return { action: { type: "start_job", jobId } };
    const acceptJob = actions.find((item) => item.type === "accept_job" && item.jobId === jobId);
    if (acceptJob) return { action: { type: "accept_job", jobId } };
    throw new DecisionValidationError("No scripted action is required");
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the five-agent pilot condition");
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

test("the supervisor fetches the catalog a brain asks for, once, and then makes it decide", async (t) => {
  const clock = new ManualClock("2042-06-01T18:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config: makeConfig(), clock });
  const configuration = loadWorldConfiguration(resolve("config/world.local-5.json"));
  configuration.version = "context-request-integration-test";
  configuration.characters = configuration.characters.filter((character) => character.id === "pilot-01");
  activateWorldConfiguration(world, configuration);

  const tokens = { "pilot-01": "pilot-01-test-secret" };
  const server = createHttpServer({ world, agentTokens: tokens, publicDir: resolve("public") });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // A brain that always asks for detail, never volunteering an action.
  const seen = [];
  const planner = {
    async decide({ observation, catalogs, contextRequestsRemaining }) {
      seen.push({ contextRequestsRemaining, catalogKeys: Object.keys(catalogs ?? {}) });
      if (contextRequestsRemaining > 0) {
        return { contextRequest: { resource: "opportunities", filters: {} }, rationale: "I want the pay first." };
      }
      const rest = observation.availableActions.find((action) => action.type === "rest");
      return { action: rest ? { type: "rest" } : { type: "record_decision", summary: "Waiting." } };
    },
  };
  const supervisor = new AgentSupervisor({
    agents: [{ characterId: "pilot-01", client: new AiterraAgentClient({ baseUrl, characterId: "pilot-01", token: tokens["pilot-01"] }) }],
    planner, concurrency: 1, pollIntervalMs: 50, decisionCooldownMs: 1, maximumActionsPerCycle: 1,
    modelCallsPerWindow: 50, modelCallWindowMs: 1_000, reconnectDelayMs: 10,
    contextMode: "progressive", contextRequestsPerDecision: 1,
    logger: { warn() {}, error() {}, log() {} },
  });
  t.after(async () => {
    await supervisor.stop();
    await new Promise((resolveClose) => server.close(resolveClose));
  });

  await supervisor.start();
  await waitFor(() => seen.length >= 2, 5_000);
  await supervisor.stop();

  // First call has the budget and no catalog; the second has the fetched catalog
  // and no budget, so the brain has to decide instead of asking again.
  assert.equal(seen[0].contextRequestsRemaining, 1);
  assert.deepEqual(seen[0].catalogKeys, []);
  assert.equal(seen[1].contextRequestsRemaining, 0);
  assert.deepEqual(seen[1].catalogKeys, ["opportunities"]);

  const report = supervisor.report();
  assert.ok(report.agents["pilot-01"].contextRequests >= 1);
  assert.equal(report.agents["pilot-01"].contextRequestsByResource.opportunities, report.agents["pilot-01"].contextRequests);
  assert.ok(report.agents["pilot-01"].observationBytes > 0, "the runtime reports what its baselines cost");

  // The request is recorded server-side as a read, and it never advanced the
  // projection the agent is holding.
  assert.ok(world.history.some((event) => event.type === "DECISION_CONTEXT_REQUESTED"));
});

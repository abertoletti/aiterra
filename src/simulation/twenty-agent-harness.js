import { resolve } from "node:path";
import { ManualClock } from "../domain/clock.js";
import { makeConfig } from "../domain/config.js";
import { World } from "../domain/world.js";
import { InMemoryEventStore } from "../infra/event-store.js";
import { createHttpServer } from "../server.js";

export async function runTwentyAgentTest({ agentCount = 20, testRunId = "twenty-agent-social-world" } = {}) {
  if (!Number.isInteger(agentCount) || agentCount < 2 || agentCount % 2 !== 0) {
    throw new Error("agentCount must be an even integer of at least 2");
  }
  const config = makeConfig({ economy: { maximumOpenSystemJobs: agentCount } });
  const clock = new ManualClock("2042-06-01T18:00:00.000Z");
  const store = new InMemoryEventStore();
  let nextId = 1;
  const world = new World({ store, config, clock, idGenerator: () => `load-${nextId++}` });
  const initialWorldTime = clock.now().toISOString();
  const characterIds = Array.from({ length: agentCount }, (_, index) => `agent-${String(index + 1).padStart(2, "0")}`);
  const agentTokens = Object.fromEntries(characterIds.map((id) => [id, `${id}-secret`]));
  const ownerTokens = Object.fromEntries(characterIds.map((id) => [`owner-${id}`, `owner-${id}-secret`]));
  const ownerCharacters = Object.fromEntries(characterIds.map((id) => [`owner-${id}`, [id]]));

  world.defineLocation({ id: "commons", name: "Town Commons" });
  world.defineLocation({ id: "workshop", name: "Community Workshop" });
  world.bootstrapEconomy();
  for (const [index, characterId] of characterIds.entries()) {
    const locationId = index < agentCount / 2 ? "commons" : "workshop";
    world.createCharacter({
      id: characterId,
      name: `Agent ${String(index + 1).padStart(2, "0")}`,
      locationId,
      primaryGoal: { type: "find_work", priority: "medium", guidance: "Find useful work and meet people." },
      skills: { social: 40, business: 40, creativity: 40, technical: 40 },
    });
    world.createSystemJob({
      id: `job-${String(index + 1).padStart(2, "0")}`,
      title: `Community shift ${String(index + 1).padStart(2, "0")}`,
      locationId,
      durationGameMinutes: 30,
      compensation: 100,
      requirements: { business: 20 },
    });
  }

  const server = createHttpServer({
    world, agentTokens, ownerTokens, ownerCharacters,
    operatorToken: "twenty-agent-operator-secret",
    cursorSecret: "twenty-agent-owner-cursor-secret",
    publicDir: resolve("public"),
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const channels = [];

  try {
    await Promise.all(characterIds.map(async (characterId) => {
      const controller = new AbortController();
      const response = await fetch(`${baseUrl}/api/characters/${characterId}/events`, {
        headers: authorization(agentTokens[characterId]),
        signal: controller.signal,
      });
      assertStatus(response, 200, `open event channel for ${characterId}`);
      channels.push({ controller, reader: response.body.getReader() });
    }));

    for (let index = 0; index < characterIds.length; index += 2) {
      const initiatorId = characterIds[index];
      const targetId = characterIds[index + 1];
      const started = await submitAction(baseUrl, agentTokens, initiatorId, {
        type: "start_conversation", targetCharacterId: targetId,
        openingMessage: `Hello ${targetId}; shall we work in the community today?`,
      }, `conversation-${index}`);
      const targetObservation = await getObservation(baseUrl, agentTokens, targetId);
      const targetNotification = targetObservation.pendingNotifications.find((item) =>
        item.conversationId === started.conversationId);
      await acknowledge(baseUrl, agentTokens, targetId, targetNotification.eventId);
      await submitAction(baseUrl, agentTokens, targetId, {
        type: "send_message", conversationId: started.conversationId,
        text: "Yes. I heard the workshop is organizing community shifts.",
        sharedFacts: [{
          id: `shift-fact-${index}`, claim: "The community workshop is organizing paid shifts.",
          subjectId: "workshop", perceivedReliability: "high",
        }],
      }, `reply-${index}`);
      const initiatorObservation = await getObservation(baseUrl, agentTokens, initiatorId);
      const initiatorNotification = initiatorObservation.pendingNotifications.find((item) =>
        item.conversationId === started.conversationId);
      if (initiatorNotification) await acknowledge(baseUrl, agentTokens, initiatorId, initiatorNotification.eventId);
      await submitAction(baseUrl, agentTokens, initiatorId, {
        type: "propose_secondary_goal",
        goal: {
          type: "strengthen_relationship", targetId,
          sourceEventId: started.eventId, priority: "medium",
          declaredReason: "The conversation created a useful social connection.",
        },
      }, `goal-${index}`);
      await submitAction(baseUrl, agentTokens, initiatorId, {
        type: "appraise_interaction", otherCharacterId: targetId,
        conversationId: started.conversationId, interactionKind: "interaction", appraisal: "appreciated",
      }, `appraise-initiator-${index}`);
      await submitAction(baseUrl, agentTokens, targetId, {
        type: "appraise_interaction", otherCharacterId: initiatorId,
        conversationId: started.conversationId, interactionKind: "interaction", appraisal: "appreciated",
      }, `appraise-target-${index}`);
      await submitAction(baseUrl, agentTokens, initiatorId, {
        type: "end_conversation", conversationId: started.conversationId,
      }, `end-${index}`);
    }

    await Promise.all(characterIds.map(async (characterId, index) => {
      const jobId = `job-${String(index + 1).padStart(2, "0")}`;
      await submitAction(baseUrl, agentTokens, characterId, { type: "accept_job", jobId }, `accept-${jobId}`);
      await submitAction(baseUrl, agentTokens, characterId, { type: "start_job", jobId }, `start-${jobId}`);
    }));
    clock.advanceGameMinutes(30);
    world.advanceTo(clock.now());

    await Promise.all(characterIds.map((characterId) => submitAction(
      baseUrl, agentTokens, characterId, { type: "rest" }, `rest-${characterId}`,
    )));
    clock.advanceGameMinutes(config.energy.restDurationGameMinutes);
    world.advanceTo(clock.now());

    const firstCharacterId = characterIds[0];
    const firstOwnerId = `owner-${firstCharacterId}`;
    const ownerHeaders = authorization(ownerTokens[firstOwnerId]);
    const feedResponse = await fetch(`${baseUrl}/api/owners/${firstOwnerId}/characters/${firstCharacterId}/feed?limit=10`, { headers: ownerHeaders });
    assertStatus(feedResponse, 200, "load owner feed");
    const feed = await feedResponse.json();
    const summaryResponse = await fetch(
      `${baseUrl}/api/owners/${firstOwnerId}/characters/${firstCharacterId}/return-summary?since=${encodeURIComponent(initialWorldTime)}`,
      { headers: ownerHeaders },
    );
    assertStatus(summaryResponse, 200, "load return summary");
    const summary = await summaryResponse.json();
    if (summary.highlights.length === 0) throw new Error("The 20-agent run produced no owner summary highlights");
    const detailId = summary.highlights[0].detailEventId;
    const detailResponse = await fetch(
      `${baseUrl}/api/owners/${firstOwnerId}/characters/${firstCharacterId}/story-details/${detailId}`,
      { headers: ownerHeaders },
    );
    assertStatus(detailResponse, 200, "open story detail");
    const ratingResponse = await fetch(
      `${baseUrl}/api/owners/${firstOwnerId}/characters/${firstCharacterId}/story-details/${detailId}/rating`,
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ rating: 5 }),
      },
    );
    assertStatus(ratingResponse, 201, "rate story detail");

    const state = world.getPublicState();
    const metrics = world.getProductMetrics({
      fromWorldTime: initialWorldTime,
      throughWorldTime: clock.now(),
      environment: "test",
      isTest: true,
      testRunId,
    });
    const compactMetrics = {
      ...metrics,
      stories: {
        candidateCount: metrics.stories.candidates.length,
        candidatesPerActiveCharacterDay: metrics.stories.candidatesPerActiveCharacterDay,
        activeCharacterDays: metrics.stories.activeCharacterDays,
      },
    };
    return {
      testRunId,
      agentCount,
      worldTime: clock.now().toISOString(),
      stateVersion: world.currentStateVersion(),
      completedJobs: state.jobs.filter((job) => job.status === "completed").length,
      completedConversations: world.history.filter((event) => event.type === "CONVERSATION_ENDED" && event.data.reason === "participant_ended").length,
      relationshipChanges: world.history.filter((event) => event.type === "RELATIONSHIP_CHANGED").length,
      completedSecondaryGoals: world.history.filter((event) => event.type === "SECONDARY_GOAL_COMPLETED").length,
      charactersAtFullEnergy: state.characters.filter((character) => character.energy === config.energy.maximum).length,
      charactersPaid: state.characters.filter((character) => character.credits === 100).length,
      activeConversations: world.history.filter((event) => event.type === "CONVERSATION_STARTED").length
        - world.history.filter((event) => event.type === "CONVERSATION_ENDED").length,
      ownerFeedItems: feed.items.length,
      ownerSummaryHighlights: summary.highlights.length,
      metrics: compactMetrics,
    };
  } finally {
    await Promise.all(channels.map(async ({ controller, reader }) => {
      controller.abort();
      try { await reader.cancel(); } catch { /* The abort already closed this stream. */ }
    }));
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function submitAction(baseUrl, tokens, characterId, action, idempotencyKey) {
  const observation = await getObservation(baseUrl, tokens, characterId);
  const response = await fetch(`${baseUrl}/api/characters/${characterId}/actions`, {
    method: "POST",
    headers: {
      ...authorization(tokens[characterId]),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ ...action, expectedStateVersion: observation.stateVersion }),
  });
  assertStatus(response, 202, `${characterId} ${action.type}`);
  return response.json();
}

// The reference harness observes the way an external runtime is expected to: a
// compact progressive baseline, echoing back the contextVersion it last saw. It
// reads only pendingNotifications and stateVersion, both of which stay in the
// baseline, so the gate exercises the progressive path end to end.
const contextVersions = new Map();

async function getObservation(baseUrl, tokens, characterId) {
  const since = contextVersions.get(characterId) ?? 0;
  const response = await fetch(
    `${baseUrl}/api/characters/${characterId}/observation?contextMode=progressive&contextVersion=${since}`,
    { headers: authorization(tokens[characterId]) },
  );
  assertStatus(response, 200, `observe ${characterId}`);
  const observation = await response.json();
  contextVersions.set(characterId, observation.contextVersion ?? 0);
  observedBytes.total += JSON.stringify(observation).length;
  observedBytes.count += 1;
  return observation;
}

export const observedBytes = { total: 0, count: 0 };

async function acknowledge(baseUrl, tokens, characterId, notificationId) {
  const response = await fetch(`${baseUrl}/api/characters/${characterId}/notifications/${notificationId}/ack`, {
    method: "POST",
    headers: authorization(tokens[characterId]),
  });
  assertStatus(response, 200, `acknowledge ${notificationId}`);
}

function authorization(token) {
  return { Authorization: `Bearer ${token}` };
}

function assertStatus(response, expected, operation) {
  if (response.status === expected) return;
  throw new Error(`${operation} failed with HTTP ${response.status}`);
}

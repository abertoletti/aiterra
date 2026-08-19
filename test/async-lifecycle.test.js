import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

test("accepted actions expose an explicit decision contract and monotonic state version", () => {
  const { world } = socialWorld();
  const result = world.executeAgentAction("jack", { type: "move", destinationId: "home" }, "move-contract");

  assert.equal(result.decisionRequiredNow, false);
  assert.equal(result.decisionRequiredAt, result.expectedEndAt);
  assert.equal(result.decisionReason, "activity_completion");
  assert.ok(Number.isInteger(result.stateVersion));
  const observation = world.getObservation("jack");
  assert.equal(observation.decisionRequiredAt, result.expectedEndAt);
  assert.equal(observation.stateVersion, result.stateVersion, "operational receipts do not invalidate the character projection version");
});

test("notification delivery freezes dual deadlines and acknowledgement is idempotent", () => {
  const { world } = socialWorld();
  const conversation = world.startConversation("jack", "sara", "Hello Sara");
  const notification = world.getPendingNotificationEvents("sara")[0];
  const deliveredAtReal = new Date("2026-08-18T10:00:00.000Z");

  const firstEnvelope = world.markNotificationDelivered("sara", notification.id, deliveredAtReal);
  const replayedEnvelope = world.markNotificationDelivered("sara", notification.id, new Date("2026-08-18T11:00:00.000Z"));
  assert.equal(firstEnvelope.conversationId, conversation.data.conversationId);
  assert.equal(firstEnvelope.timingPolicyVersion, 1);
  assert.equal(firstEnvelope.respondByWorldTime, "2042-01-01T10:08:00.000Z");
  assert.equal(firstEnvelope.respondByRealTime, "2026-08-18T10:01:20.000Z");
  assert.deepEqual(replayedEnvelope, firstEnvelope, "replay preserves the original deadline");

  const firstAck = world.acknowledgeNotification("sara", notification.id);
  const duplicateAck = world.acknowledgeNotification("sara", notification.id);
  assert.equal(duplicateAck.id, firstAck.id);
  assert.equal(world.getNotificationEnvelope(notification.id).status, "acknowledged");
});

test("a failed delivery attempt is observable without creating a replacement event or deadline", () => {
  const { world } = socialWorld();
  world.startConversation("jack", "sara", "Hello Sara");
  const notification = world.getPendingNotificationEvents("sara")[0];
  world.markNotificationDeliveryFailed("sara", notification.id, "connection_reset");
  const afterFailure = world.getNotificationEnvelope(notification.id);
  assert.equal(afterFailure.id, notification.id);
  assert.equal(afterFailure.status, "queued");
  assert.equal(afterFailure.respondByWorldTime, null);
  assert.equal(afterFailure.deliveryAttempts, 1);
  assert.equal(afterFailure.lastDeliveryFailureCode, "connection_reset");

  const delivered = world.markNotificationDelivered("sara", notification.id, new Date("2026-08-18T10:00:00.000Z"));
  assert.equal(delivered.id, notification.id);
  assert.equal(delivered.deliveryAttempts, 2);
  assert.equal(delivered.respondByWorldTime, "2042-01-01T10:08:00.000Z");
});

test("an expired expected turn resolves silence, ends the conversation, and rejects a late reply", () => {
  const { world, clock } = socialWorld();
  const conversation = world.startConversation("jack", "sara", "Are you there?");
  const notification = world.getPendingNotificationEvents("sara")[0];
  const realStart = new Date("2026-08-18T10:00:00.000Z");
  world.markNotificationDelivered("sara", notification.id, realStart);
  clock.advanceGameMinutes(8);
  world.advanceTo(clock.now(), new Date("2026-08-18T10:02:00.000Z"));

  assert.equal(world.getNotificationEnvelope(notification.id).status, "expired");
  assert.equal(world.getObservation("sara").activeConversations.length, 0);
  assert.deepEqual(dimensions(world.getRelationship("jack", "sara")), { affinity: -1, trust: -1, tension: 1 });
  assert.ok(world.history.some((event) => event.type === "CONVERSATION_TURN_EXPIRED"));
  assert.ok(world.history.some((event) => event.type === "SILENCE_RESOLVED" && event.data.explicit === false));
  assert.throws(
    () => world.sendMessage("sara", conversation.data.conversationId, "Late response"),
    (error) => error instanceof DomainError && error.code === "REACTION_WINDOW_EXPIRED",
  );
});

test("three consecutive missed responses mark an agent unavailable", () => {
  const { world, clock } = socialWorld();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const conversation = world.startConversation("jack", "sara", `Attempt ${attempt + 1}`);
    const notification = world.getPendingNotificationEvents("sara").find((event) =>
      world.getNotificationEnvelope(event.id).conversationId === conversation.data.conversationId);
    world.markNotificationDelivered("sara", notification.id, new Date(Date.UTC(2026, 7, 18, 10, attempt * 3)));
    clock.advanceGameMinutes(8);
    world.advanceTo(clock.now(), new Date(Date.UTC(2026, 7, 18, 10, attempt * 3 + 2)));
    clock.advanceGameMinutes(30);
  }

  assert.equal(world.getObservation("sara").character.agentAvailability, "unavailable");
  assert.equal(world.getObservation("sara").character.consecutiveMissedResponses, 3);
  assert.throws(
    () => world.startConversation("sara", "jack", "I am back"),
    (error) => error instanceof DomainError && error.code === "AGENT_UNAVAILABLE",
  );
  const recovery = world.verifyAgentRecovery("sara");
  assert.equal(recovery.type, "AGENT_RECOVERY_VERIFIED");
  assert.equal(world.getObservation("sara").character.agentAvailability, "available");
  assert.equal(world.getObservation("sara").character.consecutiveMissedResponses, 0);
});

test("subjective positive affinity is bounded by daily anti-farming", () => {
  const { world } = socialWorld();
  const conversation = world.startConversation("jack", "sara", "Hello");
  const id = conversation.data.conversationId;
  world.appraiseInteraction("sara", "jack", "appreciated", { conversationId: id });
  world.appraiseInteraction("sara", "jack", "appreciated", { conversationId: id });
  world.appraiseInteraction("sara", "jack", "appreciated", { conversationId: id });

  assert.equal(world.getRelationship("sara", "jack").affinity, 3, "first +2, second +1, later repetitions +0");
});

test("conversation turns are ordered and a character cannot join overlapping synchronous conversations", () => {
  const { world } = socialWorld();
  world.createCharacter({ id: "luca", name: "Luca", locationId: "neon" });
  const conversation = world.startConversation("jack", "sara", "Hello");
  assert.throws(
    () => world.sendMessage("jack", conversation.data.conversationId, "A second message before Sara responds"),
    (error) => error instanceof DomainError && error.code === "OUT_OF_TURN",
  );
  assert.throws(
    () => world.startConversation("luca", "sara", "Can I interrupt?"),
    (error) => error instanceof DomainError && error.code === "CONVERSATION_BUSY",
  );
  world.sendMessage("sara", conversation.data.conversationId, "Hello Jack");
  world.sendMessage("jack", conversation.data.conversationId, "Good to see you");
  assert.equal(world.getObservation("jack").activeConversations[0].messages.length, 3);
});

test("occupied characters remain visible and a bounded conversation closes without a silence penalty", () => {
  const { world, clock } = socialWorld();
  world.createCharacter({ id: "luca", name: "Luca", locationId: "neon" });
  const started = world.startConversation("jack", "sara", "Opening turn");
  const busyAction = world.getObservation("luca").availableActions.find((action) =>
    action.type === "start_conversation" && action.targetCharacterId === "sara");
  assert.deepEqual(busyAction.feasibility, {
    status: "occupied", eligible: false, blockingCode: "CONVERSATION_BUSY",
  });

  const conversationId = started.data.conversationId;
  for (let turn = 2; turn <= 8; turn += 1) {
    const senderId = turn % 2 === 0 ? "sara" : "jack";
    world.sendMessage(senderId, conversationId, `Turn ${turn}`);
  }

  const ended = [...world.history].reverse().find((event) =>
    event.type === "CONVERSATION_ENDED" && event.data.conversationId === conversationId);
  assert.equal(ended.data.reason, "turn_limit");
  assert.equal(ended.data.turnCount, 8);
  assert.equal(world.getObservation("jack").activeConversations.length, 0);
  assert.equal(world.getPendingNotificationEvents("jack").length, 0);
  assert.equal(world.getPendingNotificationEvents("sara").length, 0);
  assert.deepEqual(dimensions(world.getRelationship("jack", "sara")), { affinity: 0, trust: 0, tension: 0 });
  assert.equal(world.getObservation("jack").character.energy, 93);
  assert.equal(world.getObservation("sara").character.energy, 94);
});

test("departure ends a conversation with factual completion metadata", () => {
  const { world } = socialWorld();
  const started = world.startConversation("jack", "sara", "Hello");
  world.sendMessage("sara", started.data.conversationId, "A factual answer", [{
    id: "answer", claim: "The workshop opens at noon", perceivedReliability: "medium",
  }]);
  const movement = world.startMove("jack", "home");
  const ended = world.history.find((event) => event.type === "CONVERSATION_ENDED"
    && event.data.conversationId === started.data.conversationId);

  assert.equal(ended.data.reason, "departure");
  assert.equal(ended.data.turnCount, 2);
  assert.deepEqual(ended.data.producedFactIds, ["answer"]);
  assert.deepEqual(ended.causedByEventIds, [movement.id]);
  assert.equal(world.getObservation("sara").activeConversations.length, 0);
});

test("typed appraisals and objective evidence map to versioned server deltas", () => {
  const { world } = socialWorld();
  const conversation = world.startConversation("jack", "sara", "Hello");
  world.appraiseInteraction("sara", "jack", "offended", {
    conversationId: conversation.data.conversationId,
    interactionKind: "insult",
  });
  assert.deepEqual(dimensions(world.getRelationship("sara", "jack")), { affinity: -3, trust: 0, tension: 5 });

  const ended = world.endConversation("sara", conversation.data.conversationId);
  world.recordObjectiveRelationshipOutcome({
    ruleName: "promise_kept", beneficiaryId: "sara", otherCharacterId: "jack", evidenceEventId: ended.id,
  });
  assert.deepEqual(dimensions(world.getRelationship("sara", "jack")), { affinity: -2, trust: 4, tension: 4 });
  const trustChange = world.history.find((event) => event.type === "RELATIONSHIP_CHANGED"
    && event.data.rule === "promise_kept" && event.data.dimension === "trust");
  assert.equal(trustChange.data.sourceType, "objective_outcome");
  assert.equal(trustChange.data.relationshipRuleVersion, 1);
});

test("contradictory reported claims coexist privately with source and reliability provenance", () => {
  const { world } = socialWorld();
  const first = world.startConversation("jack", "sara", "What time does the workshop open?");
  world.sendMessage("sara", first.data.conversationId, "It opens at noon", [{
    id: "workshop-opening", claim: "The workshop opens at noon", perceivedReliability: "medium",
  }]);
  world.endConversation("jack", first.data.conversationId);
  world.createCharacter({ id: "luca", name: "Luca", locationId: "neon" });
  const second = world.startConversation("jack", "luca", "What time does the workshop open?");
  world.sendMessage("luca", second.data.conversationId, "It opens at one", [{
    id: "workshop-opening", claim: "The workshop opens at one", perceivedReliability: "low",
  }]);

  const claims = world.getObservation("jack").knowledge.filter((fact) => fact.id === "workshop-opening");
  assert.equal(claims.length, 2);
  assert.deepEqual(new Set(claims.map((fact) => fact.sourceCharacterId)), new Set(["sara", "luca"]));
  assert.deepEqual(new Set(claims.map((fact) => fact.perceivedReliability)), new Set(["medium", "low"]));
  assert.equal(world.getObservation("sara").knowledge.length, 0, "a received claim does not propagate to bystanders");
});

test("a confirmed platform incident pauses response and job-start penalties", () => {
  const { world, clock } = socialWorld();
  world.createCharacter({ id: "funder", name: "Funder", locationId: "neon", credits: 200 });
  world.createJob({
    creatorId: "funder", id: "incident-shift", title: "Incident shift", locationId: "neon",
    durationGameMinutes: 30, compensation: 100,
  });
  world.acceptJob("sara", "incident-shift");
  world.startConversation("jack", "sara", "Please answer");
  const notification = world.getPendingNotificationEvents("sara")[0];
  world.markNotificationDelivered("sara", notification.id, new Date("2026-08-18T10:00:00.000Z"));
  world.confirmPlatformIncident({ id: "incident-1", startedAtReal: new Date("2026-08-18T10:00:00.000Z") });

  clock.advanceGameMinutes(120);
  world.advanceTo(clock.now(), new Date("2026-08-18T10:30:00.000Z"));
  assert.equal(world.getNotificationEnvelope(notification.id).status, "delivered");
  assert.equal(world.getPublicState().jobs.find((job) => job.id === "incident-shift").status, "accepted");

  world.resolvePlatformIncident({ resolvedAtReal: new Date("2026-08-18T10:30:00.000Z") });
  assert.equal(world.getNotificationEnvelope(notification.id).respondByWorldTime, "2042-01-01T12:08:00.000Z");
  assert.equal(world.getPublicState().jobs.find((job) => job.id === "incident-shift").startGraceUntil, "2042-01-01T14:00:00.000Z");
  assert.ok(world.history.some((event) => event.type === "DEADLINE_SUPPRESSED_FOR_PLATFORM_INCIDENT"));

  clock.advanceGameMinutes(120);
  world.advanceTo(clock.now(), new Date("2026-08-18T11:00:00.000Z"));
  assert.equal(world.getPublicState().jobs.find((job) => job.id === "incident-shift").status, "failed");
  assert.equal(world.getObservation("sara").character.consecutiveMissedResponses, 1);
});

function socialWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  let nextId = 1;
  const world = new World({ store: new InMemoryEventStore(), config, clock, idGenerator: () => `async-${nextId++}` });
  world.defineLocation({ id: "home", name: "Home" });
  world.defineLocation({ id: "neon", name: "Neon Club" });
  world.createCharacter({ id: "jack", name: "Jack", locationId: "neon" });
  world.createCharacter({ id: "sara", name: "Sara", locationId: "neon" });
  return { world, clock };
}

function dimensions(relationship) {
  return { affinity: relationship.affinity, trust: relationship.trust, tension: relationship.tension };
}

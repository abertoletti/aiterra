import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDecisionMessages, DecisionValidationError, parseDecisionDocument, safeFallbackAction, validateAction,
} from "../src/agents/decision-planner.js";

test("the decision parser accepts a fenced JSON object but returns only a currently available action", () => {
  const document = parseDecisionDocument("```json\n{\"action\":{\"type\":\"start_conversation\",\"targetCharacterId\":\"pilot-02\",\"openingMessage\":\"Hello there\"}}\n```");
  const action = validateAction(document.action, observation());

  assert.deepEqual(action, {
    type: "start_conversation",
    targetCharacterId: "pilot-02",
    openingMessage: "Hello there",
  });
});

test("the model context makes required conversation text explicit even when action templates omit it", () => {
  const messages = buildDecisionMessages(observation());
  const context = JSON.parse(messages[1].content);
  assert.deepEqual(context.requiredActionShapes.start_conversation, {
    type: "start_conversation",
    targetCharacterId: "<an offered targetCharacterId>",
    openingMessage: "<required non-empty natural dialogue, 1-2000 characters>",
  });
});

test("validation failures retain the raw provider response and usage for verbose diagnostics", async () => {
  const modelClient = {
    async complete() {
      return {
        content: '{"action":{"type":"start_conversation","targetCharacterId":"pilot-02"}}',
        responseId: "response-1",
        usage: { total_tokens: 123 },
      };
    },
  };
  const { AgentDecisionPlanner } = await import("../src/agents/decision-planner.js");
  await assert.rejects(
    new AgentDecisionPlanner({ modelClient }).decide({ observation: observation() }),
    (error) => error instanceof DecisionValidationError
      && error.rawModelContent.includes("start_conversation")
      && error.usage.total_tokens === 123,
  );
});

test("the decision validator rejects invented identifiers and mechanical fields", () => {
  assert.throws(
    () => validateAction({ type: "move", destinationId: "hidden-place", credits: 1_000_000 }, observation()),
    (error) => error instanceof DecisionValidationError && /does not match/.test(error.message),
  );
  assert.throws(
    () => validateAction({ type: "set_credits", amount: 1_000_000 }, observation()),
    (error) => error instanceof DecisionValidationError && /not currently available/.test(error.message),
  );
});

test("a failed model decision falls back only to a deadline-resolving action", () => {
  const conversationObservation = observation({
    decision: { requiredNow: true, notificationEventId: "notification-1" },
    pendingNotifications: [{
      eventId: "notification-1", requestKind: "conversation_response", conversationId: "conversation-1",
    }],
    availableActions: [{ type: "remain_silent", conversationId: "conversation-1" }],
  });
  assert.deepEqual(safeFallbackAction(conversationObservation), {
    type: "remain_silent", conversationId: "conversation-1",
  });
  assert.equal(safeFallbackAction(observation()), null, "idle decisions never receive an invented fallback");
});

test("secondary goals must use a visible causal event and a known target", () => {
  const current = observation({
    relationships: [{ characterId: "pilot-02", affinity: 1, trust: 0, tension: 0 }],
    availableActions: [{ type: "propose_secondary_goal", allowedGoalTypes: ["strengthen_relationship"] }],
  });
  const action = validateAction({
    type: "propose_secondary_goal",
    goal: {
      type: "strengthen_relationship", targetId: "pilot-02", sourceEventId: "event-1",
      priority: "medium", declaredReason: "A useful conversation began.",
    },
  }, current, [{ id: "event-1", type: "CONVERSATION_STARTED" }]);
  assert.equal(action.goal.sourceEventId, "event-1");

  assert.throws(() => validateAction({
    ...action, goal: { ...action.goal, sourceEventId: "hidden-event" },
  }, current, [{ id: "event-1" }]), /not visible/);
});

function observation(overrides = {}) {
  return {
    worldTime: "2042-01-01T00:00:00.000Z",
    stateVersion: 1,
    decision: { requiredNow: true, reason: "idle", notificationEventId: null },
    character: { id: "pilot-01", name: "Mira", locationId: "commons", secondaryGoals: [] },
    nearby: [{ id: "pilot-02", name: "Jonas" }],
    relationships: [],
    activeConversations: [],
    knowledge: [],
    pendingNotifications: [],
    availableJobs: [],
    upcomingEvents: [],
    availableActions: [
      { type: "move", destinationId: "workshop" },
      { type: "start_conversation", targetCharacterId: "pilot-02" },
    ],
    ...overrides,
  };
}

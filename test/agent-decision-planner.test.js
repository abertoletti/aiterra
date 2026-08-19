import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentDecisionPlanner, buildDecisionMessages, DecisionValidationError, parseDecisionDocument,
  safeFallbackAction, validateAction, validateContextRequest,
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

test("a brain may answer with a context request while its budget allows it", async () => {
  const calls = [];
  const modelClient = {
    async complete({ messages }) {
      calls.push(JSON.parse(messages[1].content));
      return calls.length === 1
        ? { content: JSON.stringify({ requestContext: { resource: "opportunities", filters: { feasibleOnly: true } }, rationale: "I need the pay before choosing." }), responseId: "r1", usage: {} }
        : { content: JSON.stringify({ action: { type: "move", destinationId: "workshop" } }), responseId: "r2", usage: {} };
    },
  };
  const planner = new AgentDecisionPlanner({ modelClient });
  const progressive = observation({
    contextMode: "progressive",
    summaries: [{ resource: "opportunities", count: 20, feasibleCount: 4, requestAction: "inspect_opportunities" }],
  });

  const asked = await planner.decide({ observation: progressive, contextRequestsRemaining: 1 });
  assert.deepEqual(asked.contextRequest, { resource: "opportunities", filters: { feasibleOnly: true } });
  assert.equal(asked.action, undefined, "a request is not an action");

  // The runtime fetches and asks again, now with the catalog and no budget left.
  const decided = await planner.decide({
    observation: progressive, contextRequestsRemaining: 0,
    catalogs: { opportunities: { count: 20, items: [{ id: "commons-host" }] } },
  });
  assert.deepEqual(decided.action, { type: "move", destinationId: "workshop" });
  assert.equal(calls[1].catalogs.opportunities.items[0].id, "commons-host", "the fetched catalog reaches the model");
});

test("a context request past the budget is not honoured, so a runtime cannot loop on asking", async () => {
  const modelClient = {
    async complete() {
      return { content: JSON.stringify({ requestContext: { resource: "opportunities" } }), responseId: "r", usage: {} };
    },
  };
  const planner = new AgentDecisionPlanner({ modelClient });
  const progressive = observation({
    contextMode: "progressive",
    summaries: [{ resource: "opportunities", count: 20, feasibleCount: 4 }],
  });

  // With no budget the request is ignored and the document is read as an action,
  // which fails validation rather than silently becoming another round trip.
  await assert.rejects(
    () => planner.decide({ observation: progressive, contextRequestsRemaining: 0 }),
    (error) => error instanceof DecisionValidationError,
  );
});

test("a context request is limited to offered resources and allowed filters", () => {
  const progressive = observation({
    contextMode: "progressive",
    summaries: [{ resource: "opportunities", count: 3, feasibleCount: 1 }],
  });

  assert.deepEqual(
    validateContextRequest({ resource: "opportunities", filters: { locationId: "commons" } }, progressive),
    { resource: "opportunities", filters: { locationId: "commons" } },
  );
  for (const bad of [
    { resource: "buildings" },
    { resource: "opportunities", filters: { organizerId: "mira" } },
    { resource: "" },
  ]) {
    assert.throws(() => validateContextRequest(bad, progressive),
      (error) => error instanceof DecisionValidationError, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("the context protocol is offered only in progressive mode and only while budget remains", () => {
  const progressive = observation({
    contextMode: "progressive",
    summaries: [{ resource: "opportunities", count: 3, feasibleCount: 1 }],
  });
  const withBudget = buildDecisionMessages(progressive, [], [], { contextRequestsRemaining: 1 })[0].content;
  const withoutBudget = buildDecisionMessages(progressive, [], [], { contextRequestsRemaining: 0 })[0].content;
  const fullMode = buildDecisionMessages(observation(), [], [], { contextRequestsRemaining: 1 })[0].content;

  assert.ok(withBudget.includes("requestContext"), "a progressive brain with budget is told how to ask");
  assert.ok(!withoutBudget.includes("requestContext"), "spent budget removes the offer instead of tempting a refusal");
  assert.ok(!fullMode.includes("requestContext"), "full mode already carries the catalogs");
});

test("a progressive observation uses the runtime's cached manifest", () => {
  const progressive = observation({ contextMode: "progressive", rulesVersion: "agent-rules-v2" });
  delete progressive.rules;
  const cached = { version: "agent-rules-v2", energy: { maximum: 100 } };

  const context = JSON.parse(buildDecisionMessages(progressive, [], [], { rules: cached })[1].content);
  assert.deepEqual(context.rules, cached, "the model still receives the rules it must apply");
});

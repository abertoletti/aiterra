import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentDecisionPlanner, asBuildingQuoteRequest, asContextRequest, buildDecisionMessages, DecisionValidationError,
  parseDecisionDocument, safeFallbackAction, validateAction, validateBuildingQuoteRequest,
  validateContextRequest,
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

test("the decision planner accepts only a bounded optional Expected Happiness prediction", () => {
  const current = observation({
    availableActions: [{
      type: "attend_event", eventId: "night-1", expectedHappinessRange: [-15, 15],
    }],
  });
  assert.deepEqual(
    validateAction({ type: "attend_event", eventId: "night-1", expectedHappiness: 6 }, current),
    { type: "attend_event", eventId: "night-1", expectedHappiness: 6 },
  );
  assert.deepEqual(
    validateAction({ type: "attend_event", eventId: "night-1" }, current),
    { type: "attend_event", eventId: "night-1" },
    "omitting a prediction is valid and carries no invented default",
  );
  for (const value of [-16, 16, 1.5]) {
    assert.throws(
      () => validateAction({ type: "attend_event", eventId: "night-1", expectedHappiness: value }, current),
      (error) => error instanceof DecisionValidationError,
    );
  }
  const context = JSON.parse(buildDecisionMessages(current)[1].content);
  assert.match(context.requiredActionShapes.attend_event.expectedHappiness, /optional integer/);
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

  const typed = observation({
    contextMode: "progressive",
    summaries: [{
      resource: "plots", count: 400, feasibleCount: 395,
      allowedFilters: { availableOnly: "boolean", maximumDistance: "number >= 0", feasibleOnly: "boolean" },
    }],
  });
  assert.deepEqual(
    validateContextRequest({ resource: "plots", filters: { availableOnly: true, maximumDistance: 3 } }, typed),
    { resource: "plots", filters: { availableOnly: true, maximumDistance: 3 } },
  );
  assert.throws(
    () => validateContextRequest({ resource: "plots", filters: { locationId: "commons" } }, typed),
    (error) => error instanceof DecisionValidationError,
    "the summary's per-resource schema prevents a valid filter from being used on the wrong catalog",
  );
});

test("a brain can price its own complete building proposal before deciding", async () => {
  const proposal = {
    x: 8, y: 6, width: 1, height: 1,
    name: "The Workshop", description: "A focused creative workshop.",
    profile: { creativity: 60 }, capabilities: ["host_event"],
  };
  const current = observation({
    availableActions: [{
      type: "construct_building", gridWidth: 20, gridHeight: 20,
      maximumFootprint: { width: 2, height: 2 },
      capabilities: ["host_event", "sell_service"],
      profileDimensions: ["creativity", "learning"],
    }],
  });
  assert.deepEqual(validateBuildingQuoteRequest(proposal, current), proposal);
  assert.deepEqual(asBuildingQuoteRequest({
    type: "request_building_quote", proposal,
  }), proposal, "a quote wrapped as an action remains a read request");

  const calls = [];
  const planner = new AgentDecisionPlanner({
    modelClient: {
      async complete({ messages }) {
        calls.push(JSON.parse(messages[1].content));
        return calls.length === 1
          ? { content: JSON.stringify({ requestBuildingQuote: proposal, rationale: "I chose this project." }), usage: {} }
          : { content: JSON.stringify({ action: { type: "construct_building", ...proposal }, rationale: "The quoted risk suits me." }), usage: {} };
      },
    },
  });
  const requested = await planner.decide({
    observation: current, buildingQuoteRequestsRemaining: 1,
  });
  assert.deepEqual(requested.buildingQuoteRequest, proposal);
  assert.equal(requested.action, undefined);

  const quote = { constructionCost: 608, upkeepPerInterval: 18, feasibility: { status: "eligible" } };
  const decided = await planner.decide({
    observation: current, buildingQuotes: [quote], buildingQuoteRequestsRemaining: 0,
  });
  assert.deepEqual(decided.action, { type: "construct_building", ...proposal });
  assert.equal(calls[1].buildingQuotes[0].constructionCost, 608);
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

  const messages = buildDecisionMessages(progressive, [], [], { rules: cached });
  // It reaches the model on the stable system message, which is the cacheable side,
  // rather than inside the context object that changes every call.
  assert.ok(messages[0].content.includes(JSON.stringify(cached)),
    "the model still receives the rules it must apply");
  assert.equal(JSON.parse(messages[1].content).rules, undefined);
});

test("secondary goals validate against known identifiers, not against full-mode records", () => {
  // A progressive observation: no relationships, no upcomingEvents, no availableJobs.
  // Reading only those records rejected every goal type once they stopped being sent.
  const progressive = observation({
    contextMode: "progressive",
    known: { characterIds: ["pilot-02"], locationIds: ["commons", "workshop"], eventIds: ["welcome"] },
    availableActions: [
      { type: "propose_secondary_goal", allowedGoalTypes: ["strengthen_relationship", "visit_location", "attend_event", "find_work"] },
    ],
  });
  delete progressive.relationships;
  delete progressive.upcomingEvents;
  delete progressive.availableJobs;

  const history = [{ id: "ev-source", type: "CO_PRESENCE_STARTED" }];
  const propose = (goal) => validateAction({ type: "propose_secondary_goal", goal }, progressive, history);

  for (const goal of [
    { type: "strengthen_relationship", targetId: "pilot-02" },
    { type: "visit_location", targetId: "workshop" },
    { type: "attend_event", targetId: "welcome" },
    { type: "find_work", targetId: "commons" },
  ]) {
    const validated = propose({ ...goal, sourceEventId: "ev-source", declaredReason: "A reason." });
    assert.equal(validated.goal.type, goal.type);
    assert.equal(validated.goal.targetId, goal.targetId);
  }

  // Targets outside `known` are still refused, and so is an unperceived source.
  assert.throws(() => propose({ type: "strengthen_relationship", targetId: "pilot-09", sourceEventId: "ev-source", declaredReason: "x" }),
    (error) => error instanceof DecisionValidationError);
  assert.throws(() => propose({ type: "visit_location", targetId: "atlantis", sourceEventId: "ev-source", declaredReason: "x" }),
    (error) => error instanceof DecisionValidationError);
  assert.throws(() => propose({ type: "attend_event", targetId: "welcome", sourceEventId: "ev-invented", declaredReason: "x" }),
    (error) => error instanceof DecisionValidationError);
});

test("the prompt asks the character to pursue something and says how to name a goal", () => {
  const prompt = buildDecisionMessages(observation())[0].content;
  assert.ok(prompt.includes("consider a secondary goal"));
  assert.ok(prompt.includes("you may choose none"), "planning must not force arbitrary goals");
  assert.ok(prompt.includes("`known`"), "and it must say where a valid target comes from");
  assert.ok(prompt.includes("sourceEventId from goalSourceEventIds"));
  assert.ok(!prompt.includes("only when a concrete new commitment"), "the discouraging wording is gone");
});

test("the prompt states what a run is judged on, and stays a spec rather than an essay", () => {
  const prompt = buildDecisionMessages(observation())[0].content;

  // Three runs produced almost nothing but conversation while the prompt was 52 flowing
  // sentences joined by spaces. An instruction buried mid-wall is one the model will not
  // weigh, so the structure itself is part of the contract.
  assert.ok(prompt.includes("## What you are playing for"), "the objective has to be stated, not implied");
  assert.ok(prompt.includes("livedHappiness"));
  assert.ok(prompt.includes("## If nothing is pending"),
    "a free decision is where a run is won, and it needs its own section");
  assert.ok(prompt.includes("not the default"),
    "conversation is one option among the routes, and the prompt has to say so");

  // Every deliberate route a resident can take is named where a free decision is made, and
  // each is named as the command that performs it. `rest` is an ordinary English word and was
  // the only entry a model could read as advice rather than as an action, so the whole list is
  // written one way: the JSON the server expects.
  for (const route of ["host_experience", "attend_event", "construct_building", "accept_job", "rest"]) {
    assert.ok(prompt.includes(`"type":"${route}`),
      `the free-decision menu must name ${route} as its command`);
  }

  // Rest states what it does and stays OFF the priority ladder. Ranking it - it sat at 5 of 5,
  // and before that behind the word "low" with no threshold - was us deciding when a resident
  // should recover, which is the judgement the ladder exists to leave alone. The proprietor of
  // one run hosted three times at 11 Energy citing "the rules say to host immediately".
  assert.ok(prompt.includes("yours to judge"), "when to recover is the brain's call");
  assert.doesNotMatch(prompt, /^\s*\d+[a-z]?\.\s.*"type":"rest/m,
    "rest must not be a numbered entry in the ordered list");
  assert.doesNotMatch(prompt, /^\s*\d+[a-z]?\.\s.*\"type\":/m,
    "the route menu must not imply that one autonomous choice outranks another");

  // The mechanics are stated and the conclusions are left to the brain. Every phrase below is
  // a judgement the prompt used to make on the agent's behalf, and the proprietor of the run
  // that followed repeated one of them in seven of eight rationales while never once naming
  // the accessPrice that would have paid for her building.
  for (const moral of ["dead money", "BUILDING IS HALF THE JOB", "highest-value action",
    "Credits exist to be spent", "is a poor run", "pays for itself and an idle one bleeds",
    "so people will actually pay"]) {
    assert.ok(!prompt.includes(moral), `the prompt should state mechanics, not conclude: "${moral}"`);
  }
  assert.ok(prompt.includes("CEILING on every experience"));
  assert.ok(prompt.includes("Goals are free-form memory and intention, not authoritative facts"));
  assert.ok(prompt.includes("A condition already true is not a reason"));
  assert.ok(prompt.includes("merely earning more toward an already-met threshold is not a reason"));
  assert.ok(prompt.includes("Use the final reread message"));
  assert.ok(prompt.includes("include it as expectedHappiness"),
    "the external brain is asked to make the prediction the server deliberately refuses to make");

  const lines = prompt.split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  assert.ok(lines.length > 40, "structure comes from lines, not from one joined paragraph");
  assert.ok(longest < 340, `no line should be a paragraph; longest was ${longest}`);
});

test("hiring and course actions validate against their offered envelopes, never free-handed", () => {
  const current = observation({
    availableActions: [
      {
        type: "select_applicant", jobId: "role-1",
        applications: [{ applicationId: "app-1", candidateId: "pilot-02" }],
      },
      {
        type: "offer_course", buildingId: "b1",
        courseCatalog: [
          { catalogEntryId: "foundations", priceMinimum: 40, priceMaximum: 120, tradeoffLoss: null },
          { catalogEntryId: "specialization", priceMinimum: 100, priceMaximum: 300, tradeoffLoss: 3 },
        ],
        skillSet: ["social", "technical"],
        boardChoices: [{ locationId: "commons" }],
      },
      { type: "enroll_course", courseId: "course-1" },
      { type: "apply_for_role", jobId: "role-2" },
      {
        type: "move", destinationId: "workshop", durationGameMinutes: 35,
        travelOptions: [
          { vehicleId: null, minutes: 35, usageCost: 0, affordable: true },
          { vehicleId: "bicycle", minutes: 21, usageCost: 1, affordable: true },
        ],
      },
    ],
  });

  assert.deepEqual(
    validateAction({ type: "select_applicant", jobId: "role-1", applicationId: "app-1" }, current),
    { type: "select_applicant", jobId: "role-1", applicationId: "app-1" },
  );
  assert.throws(() => validateAction({ type: "select_applicant", jobId: "role-1", applicationId: "invented" }, current),
    (error) => error instanceof DecisionValidationError, "an invented application id is refused");

  assert.deepEqual(
    validateAction({ type: "apply_for_role", jobId: "role-2" }, current),
    { type: "apply_for_role", jobId: "role-2" },
  );
  // How to travel is a parameter of the move: omitted walks, a named ride must be one of
  // that destination's own travelOptions.
  assert.deepEqual(
    validateAction({ type: "move", destinationId: "workshop" }, current),
    { type: "move", destinationId: "workshop" },
  );
  assert.deepEqual(
    validateAction({ type: "move", destinationId: "workshop", vehicleId: "bicycle" }, current),
    { type: "move", destinationId: "workshop", vehicleId: "bicycle" },
  );
  assert.throws(() => validateAction({ type: "move", destinationId: "workshop", vehicleId: "car" }, current),
    (error) => error instanceof DecisionValidationError, "a ride the garage does not offer is refused");
  assert.deepEqual(
    validateAction({ type: "enroll_course", courseId: "course-1" }, current),
    { type: "enroll_course", courseId: "course-1" },
  );
  assert.throws(() => validateAction({ type: "enroll_course", courseId: "course-9" }, current),
    (error) => error instanceof DecisionValidationError);

  const offer = validateAction({
    type: "offer_course", buildingId: "b1", catalogEntryId: "foundations", skill: "social",
    price: 60, boardLocationId: "commons", title: "Working a room", description: "Basics.",
  }, current);
  assert.equal(offer.price, 60);
  assert.equal(offer.tradeoffSkill, undefined, "a positive-only entry carries no tradeoff");
  for (const bad of [
    { price: 10 },
    { skill: "magic" },
    { catalogEntryId: "invented" },
    { boardLocationId: "atlantis" },
    { tradeoffSkill: "technical" },
  ]) {
    assert.throws(() => validateAction({
      type: "offer_course", buildingId: "b1", catalogEntryId: "foundations", skill: "social",
      price: 60, boardLocationId: "commons", title: "T", description: "D", ...bad,
    }, current), (error) => error instanceof DecisionValidationError, `expected ${JSON.stringify(bad)} refused`);
  }
  // A tradeoff entry demands the paying skill, and it must be distinct.
  assert.throws(() => validateAction({
    type: "offer_course", buildingId: "b1", catalogEntryId: "specialization", skill: "social",
    price: 150, boardLocationId: "commons", title: "T", description: "D",
  }, current), (error) => error instanceof DecisionValidationError);
  assert.equal(validateAction({
    type: "offer_course", buildingId: "b1", catalogEntryId: "specialization", skill: "social",
    tradeoffSkill: "technical", price: 150, boardLocationId: "commons", title: "T", description: "D",
  }, current).tradeoffSkill, "technical");
});

test("the prompt names the course and hiring routes where free decisions are made", () => {
  const prompt = buildDecisionMessages(observation())[0].content;
  for (const route of ["enroll_course", "apply_for_role", "select_applicant", "offer_course"]) {
    assert.ok(prompt.includes(route), `the decision list must offer ${route}`);
  }
  assert.ok(prompt.includes("Tuition is never refunded"),
    "the one irreversible cost is stated where the choice is made");
  assert.ok(prompt.includes("reputation is public"),
    "and the agent is told what a track record is for");
});

test("a catalog request is honoured whichever envelope the model reaches for", async () => {
  // For three runs every request was wrapped inside `action`, because the output
  // contract says to answer with one, and every one was rejected as an unavailable
  // action type. From the outside that looked like agents never asking for anything.
  const shapes = [
    { requestContext: { resource: "experiences", filters: { tag: "music" } } },
    { action: { type: "requestContext", resource: "experiences", filters: { tag: "music" } } },
    { action: { type: "request_context", resource: "experiences", filters: { tag: "music" } } },
  ];

  for (const document of shapes) {
    const planner = new AgentDecisionPlanner({
      modelClient: { async complete() { return { content: JSON.stringify(document), responseId: "r", usage: {} }; } },
    });
    const decision = await planner.decide({
      observation: observation({
        contextMode: "progressive",
        summaries: [{ resource: "experiences", count: 3, feasibleCount: 1 }],
      }),
      contextRequestsRemaining: 1,
    });
    assert.deepEqual(decision.contextRequest, { resource: "experiences", filters: { tag: "music" } },
      `the ${JSON.stringify(document).slice(0, 40)} envelope must be read as a request`);
  }
});

test("an action that merely looks like a request is still an action", () => {
  assert.equal(asContextRequest({ type: "move", destinationId: "commons" }), null);
  assert.equal(asContextRequest({ type: "requestContext" }), null, "a request needs a resource");
});

test("free-text goals are repeated beside current facts at the decision edge without interpretation", () => {
  const current = observation({
    character: {
      id: "pilot-07", name: "Rook", locationId: "foundry", credits: 4_785, energy: 18,
      goal: "Be impossible to ignore.",
      primaryGoal: { status: "active", guidance: "Claim the hardest foundry work." },
      secondaryGoals: [
        { status: "active", guidance: "Save 2000 credits, then build a workshop." },
        { status: "abandoned", guidance: "This text must not be repeated." },
      ],
      activity: { type: "rest" },
    },
    commitments: [{ id: "commitment-1" }],
  });
  const messages = buildDecisionMessages(current);
  const reread = JSON.parse(messages[2].content.split("\n").at(-1));
  assert.deepEqual(reread, {
    goalTexts: [
      "Be impossible to ignore.",
      "Claim the hardest foundry work.",
      "Save 2000 credits, then build a workshop.",
    ],
    currentFacts: {
      credits: 4_785, energy: 18, locationId: "foundry", activity: "rest", commitments: 1,
    },
  });
  assert.equal(messages[2].role, "user");
  const framing = messages[2].content.split("\n")[0];
  assert.match(framing, /quoted verbatim/);
  assert.doesNotMatch(framing, /construct|building|job|work/i,
    "the priority message must not smuggle in a recommended action");
});

test("the rules manifest rides the stable system message, not the volatile context", () => {
  const rules = { version: "agent-rules-v3", city: { cost: "x".repeat(1_000) } };
  const messages = buildDecisionMessages(observation({ contextMode: "progressive" }), [], [], { rules });
  const context = JSON.parse(messages[1].content);

  // Measured on a live run: 1,280 of ~9,600 prompt tokens per call were cached, which is
  // exactly the system message and nothing more, because the user message begins with
  // worldTime and breaks the provider's prefix at its first byte. The manifest is
  // identical for a whole rules version, so it belongs on the cacheable side.
  assert.ok(messages[0].content.includes("## Rules (authoritative)"));
  assert.ok(messages[0].content.includes("agent-rules-v3"));
  assert.equal(context.rules, undefined, "and must not be paid for twice at full price");
  assert.equal(context.rulesVersion, observation().rulesVersion,
    "the version stays in the context so the model knows which manifest it is reading");

  // Two calls one world-minute apart must share a byte-identical system message.
  const later = buildDecisionMessages(
    observation({ contextMode: "progressive", worldTime: "2042-01-01T00:01:00.000Z" }), [], [], { rules },
  );
  assert.equal(messages[0].content, later[0].content, "the stable prefix must not drift between calls");
  assert.notEqual(messages[1].content, later[1].content);
});

test("no manifest means no empty rules heading", () => {
  const messages = buildDecisionMessages(observation());
  assert.ok(!messages[0].content.includes("## Rules"));
});

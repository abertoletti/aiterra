import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionMessages } from "../src/agents/decision-planner.js";

// The provider caches by exact prefix, so one changed byte discards everything after it.
// That makes the order of the prompt payload load-bearing in a way nothing else checks:
// moving a volatile field earlier costs real money on every call and fails no test, and the
// only symptom is a cached_tokens number nobody is looking at. These tests pin the order.
//
// The ordering came from measuring 1,001 real observations from the seven-agent pilot, field
// by field, each against the same character's previous one. worldTime used to be first: it is
// the smallest field in the prompt and the only one that changes on every single call, so the
// entire user message was uncacheable at its first byte.

function observation(overrides = {}) {
  return {
    worldTime: "2049-08-07T06:14:00.000Z",
    rulesVersion: "agent-rules-v3",
    stateVersion: 41,
    character: {
      id: "pilot-03", name: "Nia", locationId: "workshop", energy: 56, credits: 340,
      happiness: 50, activity: null, preferences: { learning: 100, nature: 100 },
    },
    nearby: [],
    relationships: [],
    knowledge: [],
    activeConversations: [],
    recentConversations: [],
    pendingNotifications: [],
    invitations: [],
    commitments: [],
    cityTonight: [],
    summaries: [],
    availableActions: [{ type: "rest", durationGameMinutes: 30 }],
    decision: { reason: "scheduled", decisionRequiredAt: "2049-08-07T06:20:00.000Z" },
    ...overrides,
  };
}

const payload = (obs) => buildDecisionMessages(obs)[1].content;
const positionOf = (content, field) => content.indexOf(`"${field}":`);

test("the volatile fields sit at the end of the payload, and worldTime is last of all", () => {
  const content = payload(observation());

  const stable = ["relationships", "knowledge", "commitments", "invitations",
    "recentConversations", "availableActions"];
  const volatile = ["character", "decision", "summaries", "worldTime"];

  for (const field of [...stable, ...volatile]) {
    assert.ok(positionOf(content, field) >= 0, `${field} should be in the payload`);
  }

  const lastStable = Math.max(...stable.map((field) => positionOf(content, field)));
  const firstVolatile = Math.min(...volatile.map((field) => positionOf(content, field)));
  assert.ok(lastStable < firstVolatile,
    "every stable field must precede every volatile one, or the prefix breaks early");

  const worldTime = positionOf(content, "worldTime");
  for (const field of [...stable, ...volatile].filter((name) => name !== "worldTime")) {
    assert.ok(positionOf(content, field) < worldTime,
      `worldTime changes every call and must come after ${field}`);
  }
});

test("availableActions carries the bulk of the payload, so it sits inside the stable prefix", () => {
  // Measured at 13.5 KB of an 18 KB payload and unchanged 72% of the time: where this one
  // field sits decides almost the whole cache hit rate.
  const content = payload(observation());
  assert.ok(positionOf(content, "availableActions") < positionOf(content, "character"),
    "availableActions must precede the character's changing state");
  assert.ok(positionOf(content, "requiredActionShapes") < positionOf(content, "worldTime"),
    "the shapes are derived from the actions and belong beside them");
});

test("changing only the moment leaves the whole stable prefix byte-identical", () => {
  // The property that actually earns the cache: two consecutive decisions for one character
  // whose world has not otherwise moved must share a long identical opening.
  const first = payload(observation());
  const second = payload(observation({
    worldTime: "2049-08-07T06:19:00.000Z",
    stateVersion: 42,
    character: { ...observation().character, energy: 51 },
    decision: { reason: "scheduled", decisionRequiredAt: "2049-08-07T06:25:00.000Z" },
  }));

  assert.notEqual(first, second, "the moment did change");
  let shared = 0;
  while (shared < first.length && first[shared] === second[shared]) shared += 1;
  assert.ok(shared > positionOf(first, "availableActions"),
    "the shared prefix must reach past availableActions, the field worth caching");
  assert.ok(shared / first.length > 0.5,
    `more than half the payload should survive a tick of the clock; shared ${shared} of ${first.length}`);
});

test("a requested catalog does not push the stable fields out of the prefix", () => {
  // Catalogs arrive on the one turn a brain asks for them. They must not sit ahead of the
  // fields that are identical every call, or asking a question would cost the cache too.
  const content = buildDecisionMessages(observation(), [], [], {
    catalogs: { opportunities: { items: [{ id: "sweep" }] } },
  })[1].content;
  assert.ok(positionOf(content, "catalogs") >= 0, "the catalog is present");
  assert.ok(positionOf(content, "availableActions") < positionOf(content, "catalogs"),
    "a one-off catalog belongs after the stable fields");
});

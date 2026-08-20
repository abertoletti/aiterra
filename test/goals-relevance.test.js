import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

test("a perceived event can create a canonical secondary goal that changes later relevance", () => {
  const { world, clock } = goalWorld();
  const source = world.establishRelationship({ fromId: "jack", toId: "sara", affinity: 10 });
  const adopted = world.proposeSecondaryGoal("jack", {
    sourceEventId: source.id,
    type: "strengthen_relationship",
    targetId: "sara",
    priority: "high",
    declaredReason: "Sara may become an important ally.",
  });

  world.startMove("sara", "neon");
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  const arrival = [...world.history].reverse().find((event) => event.type === "CHARACTER_ARRIVED" && event.data.characterId === "sara");
  const relevance = world.history.find((event) => event.type === "RELEVANCE_EVALUATED"
    && event.data.characterId === "jack" && event.data.sourceEventId === arrival.id);

  assert.equal(relevance.data.level, "HIGH");
  assert.equal(relevance.data.factors.goalMatch, 30);
  assert.equal(relevance.data.selectedGoal.goalId, adopted.data.goal.id);
  assert.equal(relevance.data.selectedGoal.goalClass, "secondary");
  assert.equal(relevance.data.relevanceRuleVersion, 1);
  assert.ok(world.getPendingNotificationEvents("jack").some((event) => event.data.sourceEventId === arrival.id));
});

test("secondary goals complete only from authoritative evidence and remain in history", () => {
  const { world, clock } = goalWorld();
  const source = world.establishRelationship({ fromId: "jack", toId: "sara", affinity: 10 });
  const adopted = world.proposeSecondaryGoal("jack", {
    sourceEventId: source.id,
    type: "strengthen_relationship",
    targetId: "sara",
    priority: "medium",
  });
  world.startMove("sara", "neon");
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  const conversation = world.startConversation("jack", "sara", "Let's work together.");
  world.appraiseInteraction("jack", "sara", "appreciated", { conversationId: conversation.data.conversationId });

  const goal = world.getObservation("jack").character.secondaryGoals.find((item) => item.id === adopted.data.goal.id);
  assert.equal(goal.status, "completed");
  assert.ok(goal.evidenceEventId);
  assert.ok(world.history.some((event) => event.type === "SECONDARY_GOAL_COMPLETED" && event.data.goalId === goal.id));
});

test("critical urgency is authoritative and cannot be manufactured by goal score", () => {
  const { world } = goalWorld();
  const source = world.establishRelationship({ fromId: "jack", toId: "sara", affinity: 80 });
  world.proposeSecondaryGoal("jack", {
    sourceEventId: source.id,
    type: "strengthen_relationship",
    targetId: "sara",
    priority: "high",
  });
  const ordinary = world.record("CHARACTER_ARRIVED", {
    actorCharacterId: "sara",
    data: { characterId: "sara", locationId: "neon", urgency: "normal" },
  });
  const normalEvaluation = world.evaluateAndMaybeNotify(ordinary, "jack");
  assert.equal(normalEvaluation.data.level, "HIGH");

  const critical = world.record("CHARACTER_ARRIVED", {
    actorCharacterId: "sara",
    data: { characterId: "sara", locationId: "neon", urgency: "critical" },
  });
  const criticalResult = world.evaluateAndMaybeNotify(critical, "jack", { urgency: "critical" });
  assert.equal(criticalResult.type, "AGENT_NOTIFICATION_QUEUED");
  assert.equal(criticalResult.data.level, "CRITICAL");
});

test("a pursue_goal goal is self-authored memory: it renders back, never self-completes, and takes no target", () => {
  // The v8 pilot's best multi-step goal - "save 2001 then build" - was re-derived from
  // scratch every turn because no goal type could hold it. Its own words are the payload.
  const { world, clock } = goalWorld();
  const source = world.establishRelationship({ fromId: "jack", toId: "sara", affinity: 10 });

  const adopted = world.proposeSecondaryGoal("jack", {
    sourceEventId: source.id,
    type: "pursue_goal",
    priority: "high",
    declaredReason: "Save 2001 credits for a 1x1 music venue: work needs-survey, rest, then build.",
  });
  const rendered = world.getObservation("jack").character.secondaryGoals
    .find((goal) => goal.id === adopted.data.goal.id);
  assert.equal(rendered.type, "pursue_goal");
  assert.equal(rendered.targetId, null);
  assert.match(rendered.guidance, /2001 credits/, "the plan's own words return in the observation");

  // Nothing the world can verify completes a self-authored goal; only its author ends it.
  clock.advanceGameMinutes(60);
  world.advanceTo(clock.now());
  assert.equal(world.getObservation("jack").character.secondaryGoals
    .find((goal) => goal.id === adopted.data.goal.id).status, "active");
  world.abandonSecondaryGoal("jack", adopted.data.goal.id);
  assert.equal(world.getObservation("jack").character.secondaryGoals
    .find((goal) => goal.id === adopted.data.goal.id).status, "abandoned");

  // A target here would be an invented mechanical handle riding a validated field.
  assert.throws(() => world.proposeSecondaryGoal("jack", {
    sourceEventId: source.id, type: "pursue_goal", targetId: "neon",
    declaredReason: "A self-authored goal with a smuggled target.",
  }), (error) => error.code === "GOAL_TARGET_NOT_ALLOWED");
});

function goalWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  let nextId = 1;
  const world = new World({ store: new InMemoryEventStore(), config, clock, idGenerator: () => `goal-${nextId++}` });
  world.defineLocation({ id: "home", name: "Home" });
  world.defineLocation({ id: "neon", name: "Neon Club" });
  world.createCharacter({ id: "jack", name: "Jack", locationId: "neon" });
  world.createCharacter({ id: "sara", name: "Sara", locationId: "home" });
  return { world, clock };
}

import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";
import { runVerticalSlice } from "../src/scenario.js";

test("the social/economic vertical slice produces an auditable causal story", () => {
  const config = makeConfig();
  const clock = new ManualClock("2042-06-12T20:00:00.000Z");
  const store = new InMemoryEventStore();
  const world = new World({ store, config, clock, idGenerator: sequentialIds() });

  const result = runVerticalSlice(world, clock);
  const jack = world.getObservation("jack").character;
  const sara = world.getObservation("sara").character;
  const job = world.getPublicState().jobs.find((item) => item.id === "bartender-shift");
  const timeline = world.getTimeline({ characterId: "jack" });

  assert.equal(jack.credits, 500, "job escrow settles to Jack exactly once");
  assert.equal(jack.energy, 80, "movement, work, and conversation have server-selected energy costs");
  assert.equal(sara.energy, 94, "movement, attendance, and conversation costs are applied");
  assert.equal(job.status, "completed");
  assert.deepEqual(
    pickDimensions(world.getRelationship("jack", "sara")),
    { affinity: 72, trust: 0, tension: 0 },
  );
  assert.deepEqual(
    pickDimensions(world.getRelationship("sara", "jack")),
    { affinity: 42, trust: 0, tension: 0 },
    "relationships remain directional",
  );
  assert.ok(world.getObservation("jack").knowledge.some((fact) => fact.id === "luca-jack-pay-claim"));

  const arrival = world.history.find((event) => event.type === "CHARACTER_ARRIVED" && event.data.characterId === "sara");
  const interruption = world.history.find((event) => event.type === "AGENT_NOTIFICATION_QUEUED"
    && event.data.characterId === "jack" && event.data.sourceEventId === arrival.id);
  assert.equal(interruption.data.level, "HIGH");

  const decision = world.history.find((event) => event.id === result.decisionEventId);
  assert.deepEqual(decision.causedByEventIds, [result.learnedEventId]);
  assert.ok(timeline.some((item) => item.type === "DECISION_RECORDED" && item.text.includes("Confront Luca")));
  assert.ok(timeline.some((item) => item.type === "CREDITS_TRANSFERRED"));
});

test("an unknown arrival is recorded as MEDIUM and does not wake observers", () => {
  const { world, clock } = basicWorld();
  world.createCharacter({ id: "stranger", name: "Stranger", locationId: "home" });

  world.startMove("stranger", "neon");
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());

  const arrival = [...world.history].reverse().find((event) => event.type === "CHARACTER_ARRIVED" && event.data.characterId === "stranger");
  const relevance = world.history.find((event) => event.type === "RELEVANCE_EVALUATED"
    && event.data.characterId === "jack" && event.data.sourceEventId === arrival.id);
  const notification = world.history.find((event) => event.type === "AGENT_NOTIFICATION_QUEUED"
    && event.data.characterId === "jack" && event.data.sourceEventId === arrival.id);

  assert.equal(relevance.data.level, "MEDIUM");
  assert.equal(notification, undefined);
});

test("the server rejects attempts to directly manipulate mechanical state", () => {
  const { world } = basicWorld();

  assert.throws(
    () => world.executeAgentAction("jack", { type: "set_credits", amount: 1_000_000 }),
    (error) => error instanceof DomainError && error.code === "UNKNOWN_ACTION",
  );
  assert.equal(world.getObservation("jack").character.credits, 100);
  assert.throws(
    () => world.startConversation("jack", "sara"),
    (error) => error instanceof DomainError && error.code === "NOT_COLOCATED",
  );
});

test("job creation reserves escrow and completion is replay-safe", () => {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  const store = new InMemoryEventStore();
  const world = new World({ store, config, clock, idGenerator: sequentialIds() });
  world.defineLocation({ id: "neon", name: "Neon Club" });
  world.createCharacter({ id: "luca", name: "Luca", locationId: "neon", credits: 400 });
  world.createCharacter({ id: "jack", name: "Jack", locationId: "neon", credits: 0, skills: { social: 50 } });
  world.createJob({ creatorId: "luca", id: "shift", title: "Shift", locationId: "neon", durationGameMinutes: 30, compensation: 300, requirements: { social: 30 } });

  assert.equal(world.getObservation("luca").character.credits, 100);
  world.acceptJob("jack", "shift");
  world.startJob("jack", "shift");
  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());
  assert.equal(world.getObservation("jack").character.credits, 300);

  const replayed = new World({ store, config, clock, idGenerator: sequentialIds(1_000) });
  assert.deepEqual(replayed.getPublicState(), world.getPublicState());
  replayed.advanceTo(clock.now());
  assert.equal(replayed.getObservation("jack").character.credits, 300, "replay does not pay twice");
});

test("idempotency returns the original action result without applying it twice", () => {
  const { world } = basicWorld();
  const first = world.executeAgentAction("jack", { type: "move", destinationId: "home" }, "move-1");
  const second = world.executeAgentAction("jack", { type: "move", destinationId: "home" }, "move-1");

  assert.deepEqual(second, first);
  assert.equal(world.history.filter((event) => event.type === "MOVEMENT_STARTED" && event.data.characterId === "jack").length, 1);
  assert.equal(world.getObservation("jack").character.energy, 98);
});

test("unchanged opportunity observations are recorded only once", () => {
  const { world } = basicWorld();
  world.createJob({
    creatorId: "jack", id: "visible-shift", title: "Visible shift", locationId: "neon",
    durationGameMinutes: 30, compensation: 100, requirements: {},
  });
  const first = world.recordOpportunitiesViewed("jack", ["visible-shift"], []);
  const duplicate = world.recordOpportunitiesViewed("jack", ["visible-shift"], []);

  assert.equal(first.recorded, true);
  assert.equal(duplicate.recorded, false);
  assert.equal(world.history.filter((event) => event.type === "OPPORTUNITIES_VIEWED").length, 1);
});

function basicWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config, clock, idGenerator: sequentialIds() });
  world.defineLocation({ id: "home", name: "Home" });
  world.defineLocation({ id: "neon", name: "Neon Club" });
  world.createCharacter({ id: "jack", name: "Jack", locationId: "neon", credits: 100 });
  world.createCharacter({ id: "sara", name: "Sara", locationId: "home", credits: 100 });
  return { world, clock, config };
}

function sequentialIds(start = 1) {
  let current = start;
  return () => `event-${current++}`;
}

function pickDimensions(relationship) {
  return { affinity: relationship.affinity, trust: relationship.trust, tension: relationship.tension };
}

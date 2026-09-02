import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

function selectedContextWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  const store = new InMemoryEventStore();
  let nextId = 1;
  const world = new World({ store, config, clock, idGenerator: () => `selected-${nextId++}` });
  world.defineLocation({ id: "work", name: "Workshop" });
  world.createCharacter({ id: "funder", name: "Funder", locationId: "work", credits: 10_000 });
  world.createCharacter({ id: "worker", name: "Worker", locationId: "work", credits: 0, skills: { business: 50 } });
  for (let index = 1; index <= 4; index += 1) {
    world.createJob({
      creatorId: "funder", id: `job-${index}`, title: `Job ${index}`, locationId: "work",
      durationGameMinutes: 30, compensation: 100, requirements: { business: 30 },
    });
  }
  return { world, clock, store, config };
}

test("selected context is sanitized, ordered, capped, replaceable, and replay-safe", () => {
  const { world, store, config, clock } = selectedContextWorld();
  const first = world.selectContext("worker", { resource: "opportunities", itemId: "job-1" });
  const repeated = world.selectContext("worker", { resource: "opportunities", itemId: "job-1" });
  assert.equal(repeated.reused, true, "the same selected item is semantically idempotent");
  world.selectContext("worker", { resource: "opportunities", itemId: "job-2" });
  world.selectContext("worker", { resource: "opportunities", itemId: "job-3" });
  assert.throws(() => world.selectContext("worker", { resource: "opportunities", itemId: "job-4" }),
    (error) => error instanceof DomainError && error.code === "CONTEXT_SELECTION_LIMIT_REACHED");

  world.selectContext("worker", {
    resource: "opportunities", itemId: "job-4", replacesSelectionId: first.selection.selectionId,
  });
  const observation = world.getObservation("worker");
  assert.deepEqual(observation.selectedContexts.filter((item) => !item.stale).map((item) => item.itemId),
    ["job-2", "job-3", "job-4"]);
  assert.equal(observation.selectedContexts.find((item) => item.selectionId === first.selection.selectionId).stale, true);
  const catalogJob = world.inspectContext("worker", {
    resource: "opportunities", limit: 50, decisionCycleId: observation.decisionCycleId,
  }).items
    .find((item) => item.id === "job-2");
  assert.deepEqual(observation.selectedContexts.find((item) => item.itemId === "job-2").details, catalogJob,
    "the retained snapshot uses the same sanitized visibility projection as the catalog");
  assert.deepEqual(world.getObservation("worker", { contextMode: "progressive" }).selectedContexts, observation.selectedContexts);

  const replayed = new World({ store, config, clock });
  assert.deepEqual(replayed.getObservation("worker").selectedContexts, observation.selectedContexts,
    "retained selections are recovered solely from lifecycle events");
});

test("unengaged selections expire once and a stale-target rejection closes its entire cycle", () => {
  const { world, clock } = selectedContextWorld();
  const selected = world.selectContext("worker", { resource: "opportunities", itemId: "job-1" });
  clock.advanceGameMinutes(360);
  world.advanceTo(clock.now());
  const stale = world.getObservation("worker").selectedContexts.find((item) => item.selectionId === selected.selection.selectionId);
  assert.equal(stale.stale, true);
  assert.equal(stale.invalidation.code, "CONTEXT_TTL_EXPIRED");
  assert.throws(() => world.inspectContext("worker", { resource: "opportunities" }),
    (error) => error instanceof DomainError && error.code === "CONTEXT_DECISION_CYCLE_REQUIRED");
  assert.equal(world.inspectContext("worker", {
    resource: "opportunities", decisionCycleId: stale.decisionCycleId,
  }).decisionCycleId, stale.decisionCycleId, "correlated reads preserve the open stale cycle");

  assert.throws(() => world.executeAgentAction("worker", {
    type: "accept_job", jobId: "job-1", decisionCycleId: stale.decisionCycleId,
  }, "stale-job"),
    (error) => error instanceof DomainError && error.code === "CONTEXT_SELECTION_STALE");
  assert.equal(world.getObservation("worker").selectedContexts.length, 0,
    "the rejected stale action resolves the stale decision cycle exactly once");
  assert.throws(() => world.executeAgentAction("worker", {
    type: "accept_job", jobId: "job-1", decisionCycleId: stale.decisionCycleId,
  }, "stale-job"),
    (error) => error instanceof DomainError && error.code === "CONTEXT_SELECTION_STALE",
    "idempotent stale rejection returns the original error without a mechanical side effect");
});

test("engaging a selected job pins it and terminal invalidation preserves first cause", () => {
  const { world } = selectedContextWorld();
  const selected = world.selectContext("worker", { resource: "opportunities", itemId: "job-1" });
  world.acceptJob("worker", "job-1");
  assert.equal(world.getObservation("worker").selectedContexts.find((item) => item.selectionId === selected.selection.selectionId).pinned, true);
  world.cancelJob("worker", "job-1");
  const stale = world.getObservation("worker").selectedContexts.find((item) => item.selectionId === selected.selection.selectionId);
  assert.equal(stale.stale, true);
  assert.equal(stale.invalidation.code, "CONTEXT_ITEM_WITHDRAWN");
});

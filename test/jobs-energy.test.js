import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

test("job publication discloses and reserves the complete versioned escrow contract", () => {
  const { world } = jobWorld();
  world.createJob(jobOffer());

  const job = findJob(world, "shift");
  assert.equal(world.getObservation("funder").character.credits, 100);
  assert.equal(job.status, "open");
  assert.equal(job.reservation.state, "reserved");
  assert.equal(job.reservation.amount, 300);
  assert.equal(job.reservation.currency, "credits");
  assert.equal(job.reservation.policyVersion, 1);
  assert.equal(job.reservation.originalFundingSource.id, "funder");
  assert.equal(job.startGraceUntil, "2042-01-01T12:00:00.000Z");
  assert.equal(job.offerExpiresAt, "2042-01-02T10:00:00.000Z");
  assert.ok(world.history.some((event) => event.type === "JOB_ESCROW_RESERVED" && event.data.jobId === "shift"));
});

test("an open offer expires and refunds its original source exactly once", () => {
  const { world, clock, store, config } = jobWorld();
  world.createJob(jobOffer());
  clock.advanceGameMinutes(24 * 60);
  world.advanceTo(clock.now());
  world.advanceTo(clock.now());

  assert.equal(findJob(world, "shift").status, "expired");
  assert.equal(findJob(world, "shift").reservation.state, "refunded");
  assert.equal(world.getObservation("funder").character.credits, 400);
  assert.equal(world.history.filter((event) => event.type === "JOB_ESCROW_REFUNDED").length, 1);

  const replayed = new World({ store, config, clock, idGenerator: sequentialIds(1_000) });
  replayed.advanceTo(clock.now());
  assert.equal(replayed.getObservation("funder").character.credits, 400);
  assert.equal(findJob(replayed, "shift").status, "expired");
});

test("funder cancellation after acceptance applies the disclosed 20/80 split", () => {
  const { world } = jobWorld();
  world.createJob(jobOffer());
  world.acceptJob("worker", "shift");
  world.cancelJob("funder", "shift");

  const job = findJob(world, "shift");
  assert.equal(job.status, "cancelled");
  assert.equal(job.terminalCause, "funder_cancelled_after_acceptance");
  assert.equal(job.reservation.state, "split");
  assert.equal(world.getObservation("worker").character.credits, 60);
  assert.equal(world.getObservation("funder").character.credits, 340);
  assert.ok(world.history.some((event) => event.type === "JOB_ESCROW_SPLIT" && event.data.workerAmount === 60));
});

test("worker cancellation and no-show refund the funder without paying the worker", () => {
  const cancelled = jobWorld();
  cancelled.world.createJob(jobOffer());
  cancelled.world.acceptJob("worker", "shift");
  cancelled.world.cancelJob("worker", "shift");
  assert.equal(findJob(cancelled.world, "shift").terminalCause, "worker_cancelled_before_start");
  assert.equal(cancelled.world.getObservation("funder").character.credits, 400);
  assert.equal(cancelled.world.getObservation("worker").character.credits, 0);

  const noShow = jobWorld();
  noShow.world.createJob(jobOffer());
  noShow.world.acceptJob("worker", "shift");
  noShow.clock.advanceGameMinutes(120);
  noShow.world.advanceTo(noShow.clock.now());
  assert.equal(findJob(noShow.world, "shift").status, "failed");
  assert.equal(findJob(noShow.world, "shift").terminalCause, "worker_no_show");
  assert.equal(noShow.world.getObservation("funder").character.credits, 400);
  assert.equal(noShow.world.getObservation("worker").character.credits, 0);
});

test("a worker can abandon running work, while its funder cannot cancel it", () => {
  const { world } = jobWorld();
  world.createJob(jobOffer());
  world.acceptJob("worker", "shift");
  world.startJob("worker", "shift");

  assert.throws(
    () => world.cancelJob("funder", "shift"),
    (error) => error instanceof DomainError && error.code === "FUNDER_CANNOT_CANCEL_RUNNING_JOB",
  );
  world.cancelJob("worker", "shift");
  assert.equal(findJob(world, "shift").status, "failed");
  assert.equal(findJob(world, "shift").terminalCause, "worker_abandoned_after_start");
  assert.equal(world.getObservation("funder").character.credits, 400);
  assert.equal(world.getObservation("worker").character.activity, null);
});

test("job acceptance revalidates location and prevents overlapping commitments", () => {
  const { world, clock } = jobWorld();
  world.defineLocation({ id: "remote", name: "Remote" });
  world.createJob(jobOffer());
  world.createJob({ ...jobOffer(), id: "second-shift", compensation: 50 });
  world.startMove("worker", "remote");
  assert.throws(
    () => world.acceptJob("worker", "shift"),
    (error) => error instanceof DomainError && error.code === "ACTIVITY_CONFLICT",
  );
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  assert.throws(
    () => world.acceptJob("worker", "shift"),
    (error) => error instanceof DomainError && error.code === "WRONG_LOCATION",
  );

  const local = jobWorld();
  local.world.createJob(jobOffer());
  local.world.createJob({ ...jobOffer(), id: "second-shift", compensation: 50 });
  local.world.acceptJob("worker", "shift");
  assert.throws(
    () => local.world.acceptJob("worker", "second-shift"),
    (error) => error instanceof DomainError && error.code === "JOB_COMMITMENT_CONFLICT",
  );
});

test("system-funded jobs use a separate bounded bootstrap budget", () => {
  const { world, clock } = jobWorld();
  world.bootstrapEconomy();
  world.createSystemJob({ ...jobOffer(), creatorId: undefined, budgetId: "world-bootstrap" });
  assert.equal(world.getPublicState().economy.systemBudgets[0].balance, 9_700);
  world.acceptJob("worker", "shift");
  world.startJob("worker", "shift");
  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());

  assert.equal(world.getObservation("worker").character.credits, 300);
  assert.equal(world.getPublicState().economy.systemBudgets[0].balance, 9_700);
  assert.equal(findJob(world, "shift").reservation.state, "settled");
});

test("rest recovers once at completion, caps energy, and does not hide perceptible events", () => {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config, clock, idGenerator: sequentialIds() });
  world.defineLocation({ id: "home", name: "Home" });
  world.defineLocation({ id: "square", name: "Square" });
  world.createCharacter({ id: "resting", name: "Resting", locationId: "home", energy: 90 });
  world.createCharacter({ id: "visitor", name: "Visitor", locationId: "square" });

  world.startRest("resting");
  assert.throws(
    () => world.startConversation("resting", "visitor", "Can we talk?"),
    (error) => error instanceof DomainError && error.code === "NOT_COLOCATED",
  );
  world.startMove("visitor", "home");
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  assert.ok(world.history.some((event) => event.type === "RELEVANCE_EVALUATED"
    && event.data.characterId === "resting" && event.data.perceptible));
  assert.equal(world.getObservation("resting").character.activity.type, "rest");
  assert.throws(
    () => world.startConversation("resting", "visitor", "Can we talk now?"),
    (error) => error instanceof DomainError
      && error.code === "INTERACTION_BLOCKED"
      && error.details.alternatives.includes("wait_for_activity_completion"),
  );

  clock.advanceGameMinutes(45);
  world.advanceTo(clock.now());
  world.advanceTo(clock.now());
  assert.equal(world.getObservation("resting").character.energy, 100);
  assert.equal(world.history.filter((event) => event.type === "REST_COMPLETED").length, 1);
});

test("work declares compatible social reactions and correlates a conversation without interrupting the job", () => {
  const { world } = jobWorld();
  world.createCharacter({ id: "colleague", name: "Colleague", locationId: "work" });
  world.createJob(jobOffer());
  world.acceptJob("worker", "shift");
  world.startJob("worker", "shift");
  const observation = world.getObservation("worker");
  assert.ok(observation.character.activity.compatibleSecondaryActions.includes("start_conversation"));
  const conversation = world.startConversation("worker", "colleague", "Hello during my shift");
  assert.deepEqual(conversation.data.duringActivities, [{
    characterId: "worker", type: "work", jobId: "shift", eventId: null,
  }]);
  assert.equal(conversation.data.socialEnergyCost, 1);
  assert.equal(world.getObservation("worker").character.energy, 83, "start plus opening turn use two social energy");
  assert.equal(world.getObservation("worker").character.activity.jobId, "shift");
});

test("ineligible jobs remain visible with requirements and authoritative rejection metadata", () => {
  const { world } = jobWorld();
  world.defineLocation({ id: "archive", name: "Archive" });
  world.createJob({
    ...jobOffer(), id: "advanced-repair", title: "Advanced repair",
    requirements: { technical: 60 }, compensation: 100,
  });
  world.createJob({
    ...jobOffer(), id: "remote-ledger", title: "Remote ledger", locationId: "archive",
    requirements: { business: 30 }, compensation: 100,
  });

  const observation = world.getObservation("worker");
  const action = observation.availableActions.find((item) => item.type === "accept_job" && item.jobId === "advanced-repair");
  assert.equal(action.requirements.technical, 60);
  assert.deepEqual(action.unmetRequirements, [{ skill: "technical", required: 60, actual: 0 }]);
  assert.deepEqual(action.feasibility, {
    status: "blocked", eligible: false,
    blockingCode: "SKILL_REQUIREMENT", blockingCodes: ["SKILL_REQUIREMENT"],
  });
  const remote = observation.availableActions.find((item) => item.type === "accept_job" && item.jobId === "remote-ledger");
  assert.equal(remote.locationId, "archive");
  assert.equal(remote.executionEnergyCost, 15);
  assert.deepEqual(remote.feasibility, {
    status: "blocked", eligible: false,
    blockingCode: "WRONG_LOCATION", blockingCodes: ["WRONG_LOCATION"],
  });
  assert.throws(
    () => world.acceptJob("worker", "advanced-repair"),
    (error) => error instanceof DomainError && error.code === "SKILL_REQUIREMENT",
  );
});

test("busy agents still receive public job choices with every known blocker", () => {
  const { world } = jobWorld();
  world.createJob(jobOffer());
  world.acceptJob("worker", "shift");
  world.startJob("worker", "shift");
  world.createJob({
    ...jobOffer(), id: "follow-up", title: "Follow-up task", compensation: 50,
    requirements: { technical: 10 },
  });

  const action = world.getObservation("worker").availableActions.find((item) =>
    item.type === "accept_job" && item.jobId === "follow-up");
  assert.deepEqual(action.feasibility, {
    status: "blocked", eligible: false,
    blockingCode: "ACTIVITY_CONFLICT",
    blockingCodes: ["ACTIVITY_CONFLICT", "JOB_COMMITMENT_CONFLICT", "SKILL_REQUIREMENT"],
  });
});

function jobWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  const store = new InMemoryEventStore();
  const world = new World({ store, config, clock, idGenerator: sequentialIds() });
  world.defineLocation({ id: "work", name: "Workshop" });
  world.createCharacter({ id: "funder", name: "Funder", locationId: "work", credits: 400 });
  world.createCharacter({ id: "worker", name: "Worker", locationId: "work", credits: 0, skills: { business: 50 } });
  return { world, clock, store, config };
}

function jobOffer() {
  return {
    creatorId: "funder", id: "shift", title: "Workshop shift", locationId: "work",
    durationGameMinutes: 30, compensation: 300, requirements: { business: 30 },
  };
}

function findJob(world, id) {
  return world.getPublicState().jobs.find((job) => job.id === id);
}

function sequentialIds(start = 1) {
  let current = start;
  return () => `event-${current++}`;
}

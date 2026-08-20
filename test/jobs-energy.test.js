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

test("a job you cannot yet do stays fully described, on the map rather than the menu", () => {
  const { world } = jobWorld();
  world.createJob({
    ...jobOffer(), id: "advanced-repair", title: "Advanced repair",
    requirements: { technical: 60 }, compensation: 100,
  });

  const observation = world.getObservation("worker");
  assert.ok(!observation.availableActions.some((action) => action.jobId === "advanced-repair"),
    "the menu holds only what can be ordered now");
  const entry = observation.opportunities.find((item) => item.jobId === "advanced-repair");
  assert.ok(entry, "but the notice is still readable in full");
  assert.equal(entry.compensation, 100);
  assert.equal(entry.executionEnergyCost, 15);
  assert.equal(entry.requirements.technical, 60);
  assert.deepEqual(entry.unmetRequirements, [{ skill: "technical", required: 60, actual: 0 }],
    "and it says exactly what is missing, which is what makes it a plan");
  assert.deepEqual(entry.blockedBy, ["SKILL_REQUIREMENT"]);
  assert.deepEqual(observation.cannotRightNow, [],
    "one blocked notice keeps its own reason: there is nothing to share it with");

  assert.throws(
    () => world.acceptJob("worker", "advanced-repair"),
    (error) => error instanceof DomainError && error.code === "SKILL_REQUIREMENT",
  );
});

test("a notice board stands in a square, so another square's work is somewhere you walk to", () => {
  // WRONG_LOCATION used to be the single loudest blocker in the observation - nine of the
  // fourteen jobs offered to one resident carried it, none of which she could reach without
  // travelling first. A board is a physical thing: you read the one you are standing at, and
  // the others are a reason to go somewhere rather than noise in the list.
  const { world } = jobWorld();
  world.defineLocation({ id: "archive", name: "Archive", x: 9, y: 9 });
  world.createJob({
    ...jobOffer(), id: "remote-ledger", title: "Remote ledger", locationId: "archive",
    requirements: { business: 0 }, compensation: 100,
  });

  const observation = world.getObservation("worker");
  for (const list of ["availableActions", "opportunities"]) {
    assert.ok(!observation[list].some((entry) => entry.jobId === "remote-ledger"),
      `another square's notice is not in ${list}`);
  }

  // What it does get is the existence of the market and the cost of reaching it.
  const board = observation.jobBoards.find((entry) => entry.locationId === "archive");
  assert.ok(board, "the square itself is known");
  assert.equal(board.openJobs, 1, "with how much work is waiting there");
  assert.equal(board.here, false);
  assert.ok(board.travelMinutes > 0, "and what the trip costs");
  assert.ok(observation.jobBoards.some((entry) => entry.here), "including the one underfoot");
});

test("busy agents still see the whole notice, with every known blocker", () => {
  const { world } = jobWorld();
  world.createJob(jobOffer());
  world.acceptJob("worker", "shift");
  world.startJob("worker", "shift");
  world.createJob({
    ...jobOffer(), id: "follow-up", title: "Follow-up task", compensation: 50,
    requirements: { technical: 10 },
  });

  const single = world.getObservation("worker");
  const entry = single.opportunities.find((item) => item.jobId === "follow-up");
  assert.ok(entry, "a busy worker still reads the board");
  assert.equal(entry.compensation, 50);
  assert.deepEqual(entry.blockedBy,
    ["ACTIVITY_CONFLICT", "JOB_COMMITMENT_CONFLICT", "SKILL_REQUIREMENT"],
    "a lone notice carries all of its own reasons");

  // Add a second unreachable notice and the causes they share are stated once instead of
  // once per notice - the line that would have told Nia why all fourteen of hers failed.
  world.createJob({
    ...jobOffer(), id: "third-task", title: "Third task", compensation: 40,
    requirements: { technical: 10 },
  });
  const observation = world.getObservation("worker");
  const hoisted = observation.cannotRightNow.filter((reason) => reason.action === "accept_job");
  assert.deepEqual(hoisted.map((reason) => reason.code).sort(),
    ["ACTIVITY_CONFLICT", "JOB_COMMITMENT_CONFLICT", "SKILL_REQUIREMENT"]);
  assert.ok(hoisted.every((reason) => reason.affects === 2));
  const now = observation.opportunities.find((item) => item.jobId === "follow-up");
  assert.deepEqual(now.blockedBy, [],
    "what stays on a notice is only what is specific to it");
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

test("a standing post goes on cooldown and comes back instead of expiring", async () => {
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config: makeConfig(), clock });
  world.defineLocation({ id: "commons", name: "Commons" });
  world.bootstrapEconomy({ budgetId: "budget", credits: 1_000 });
  world.createCharacter({
    id: "mira", name: "Mira", locationId: "commons", personality: [], goal: "Earn.",
  });
  world.createSystemJob({
    budgetId: "budget", id: "sweep", title: "Sweep the commons", locationId: "commons",
    durationGameMinutes: 10, compensation: 50, repeatable: true, cooldownGameMinutes: 30,
  });

  const budget = () => world.getPublicState().economy.systemBudgets.find((entry) => entry.id === "budget").balance;
  assert.equal(budget(), 950, "the first cycle reserves its escrow");

  world.acceptJob("mira", "sweep");
  world.startJob("mira", "sweep");
  clock.advanceGameMinutes(10);
  world.advanceTo(clock.now());
  assert.equal(world.state.jobs.get("sweep").status, "completed");
  assert.equal(world.getObservation("mira").character.credits, 50, "and pays out on completion");

  // Still on cooldown: a standing post is not instantly back.
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  assert.equal(world.state.jobs.get("sweep").status, "completed");

  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  const reopened = world.state.jobs.get("sweep");
  assert.equal(reopened.status, "open", "the board never empties");
  assert.deepEqual(reopened.workerIds, []);
  assert.equal(reopened.timesCompleted, 1);
  assert.equal(budget(), 900, "and the next cycle reserves again");
  assert.ok(world.getObservation("mira").availableActions
    .some((action) => action.type === "accept_job" && action.jobId === "sweep"),
  "so the same work can be done again");
});

test("a standing post stays closed once its funder cannot cover it", async () => {
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config: makeConfig(), clock });
  world.defineLocation({ id: "commons", name: "Commons" });
  world.bootstrapEconomy({ budgetId: "budget", credits: 50 });
  world.createCharacter({ id: "mira", name: "Mira", locationId: "commons", personality: [], goal: "Earn." });
  world.createSystemJob({
    budgetId: "budget", id: "sweep", title: "Sweep", locationId: "commons",
    durationGameMinutes: 10, compensation: 50, repeatable: true, cooldownGameMinutes: 10,
  });

  world.acceptJob("mira", "sweep");
  world.startJob("mira", "sweep");
  clock.advanceGameMinutes(60);
  world.advanceTo(clock.now());

  // A world that has spent its bootstrap budget should run out of work, not out of rules.
  assert.equal(world.state.jobs.get("sweep").status, "completed");
  assert.equal(world.getPublicState().economy.systemBudgets.find((e) => e.id === "budget").balance, 0);
});

test("a post nobody turned up for goes back on the board, it is not deleted", () => {
  // Only a completion used to schedule the reopen, so a worker who accepted a job and then
  // wandered off deleted it permanently: three of the pilot's twenty seeded jobs died that
  // way, two to no-shows and one to a cancellation. The post is still needed afterwards.
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config: makeConfig(), clock });
  world.defineLocation({ id: "commons", name: "Commons" });
  world.bootstrapEconomy({ budgetId: "budget", credits: 1_000 });
  world.createCharacter({
    id: "mira", name: "Mira", locationId: "commons", personality: [], goal: "Earn.",
  });
  world.createSystemJob({
    budgetId: "budget", id: "sweep", title: "Sweep the commons", locationId: "commons",
    durationGameMinutes: 10, compensation: 50, repeatable: true, cooldownGameMinutes: 30,
  });

  world.acceptJob("mira", "sweep");
  // Never started. The grace window closes and the world calls it a no-show.
  clock.advanceGameMinutes(makeConfig().jobs.startGraceWorldHours * 60 + 1);
  world.advanceTo(clock.now());
  const failed = world.state.jobs.get("sweep");
  assert.equal(failed.status, "failed");
  assert.equal(failed.terminalCause, "worker_no_show");
  assert.ok(failed.reopensAt, "a repeatable post schedules its return even after a no-show");

  clock.advanceGameMinutes(31);
  world.advanceTo(clock.now());
  const reopened = world.state.jobs.get("sweep");
  assert.equal(reopened.status, "open", "the board keeps the post");
  assert.deepEqual(reopened.workerIds, []);
  assert.ok(world.history.some((event) => event.type === "JOB_REOPENED" && event.data.jobId === "sweep"));
});

test("finishing a job frees the worker for a different one, not just the same one again", () => {
  // Completing a post used to count as still being committed to it, because the check
  // matched any job that listed the character and was not "open" - which a completed job
  // stays until its cooldown returns it. A resident who finished a job was therefore locked
  // out of the whole board until that same job came back, so the only job they could ever
  // take was the one they had just done. The pilot's 27 completions landed on three job ids.
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config: makeConfig(), clock });
  world.defineLocation({ id: "commons", name: "Commons" });
  world.bootstrapEconomy({ budgetId: "budget", credits: 1_000 });
  world.createCharacter({
    id: "mira", name: "Mira", locationId: "commons", personality: [], goal: "Earn.",
  });
  for (const id of ["sweep", "tidy"]) {
    world.createSystemJob({
      budgetId: "budget", id, title: `Job ${id}`, locationId: "commons",
      durationGameMinutes: 10, compensation: 50, repeatable: true, cooldownGameMinutes: 30,
    });
  }

  world.acceptJob("mira", "sweep");
  world.startJob("mira", "sweep");
  clock.advanceGameMinutes(10);
  world.advanceTo(clock.now());
  assert.equal(world.state.jobs.get("sweep").status, "completed");

  // "sweep" is finished but still on cooldown, so it has not reopened and still lists Mira.
  assert.equal(world.state.jobs.get("sweep").workerIds.includes("mira"), true);
  const observation = world.getObservation("mira");
  const tidy = observation.availableActions
    .find((action) => action.type === "accept_job" && action.jobId === "tidy");
  assert.ok(tidy, "the other job is orderable, not merely visible");
  assert.ok(!observation.cannotRightNow.some((reason) => reason.code === "JOB_COMMITMENT_CONFLICT"),
    "a finished job must not read as an active commitment");

  world.acceptJob("mira", "tidy");
  assert.equal(world.state.jobs.get("tidy").status, "accepted");
});

import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { World } from "../src/domain/world.js";
import { validateAction } from "../src/agents/decision-planner.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

function lifecycleWorld(credits = 500) {
  const clock = new ManualClock("2042-05-01T10:00:00.000Z");
  const config = makeConfig({ city: { upkeepIntervalWorldMinutes: 60 } });
  const world = new World({ store: new InMemoryEventStore(), config, clock, random: () => 0.5 });
  world.defineLocation({ id: "square", name: "The Square", x: 5, y: 5 });
  world.bootstrapEconomy({ budgetId: "budget", credits: 100_000 });
  world.createCharacter({ id: "owner", name: "Owner", locationId: "square", credits });
  return { world, clock, config };
}

function build(world) {
  return world.constructBuilding("owner", {
    x: 6, y: 5, name: "The Room", profile: { music: 100 },
    capabilities: ["host_event", "sell_access", "create_job", "sell_service"],
  }).data.buildingId;
}

function advance(world, clock, minutes) {
  clock.advanceGameMinutes(minutes);
  world.advanceTo(clock.now());
}

function earnLater(world, durationGameMinutes, compensation = 10) {
  const job = world.createSystemJob({
    budgetId: "budget", title: "Earn recovery money", locationId: "square",
    durationGameMinutes, compensation,
  });
  world.acceptJob("owner", job.data.id);
  world.startJob("owner", job.data.id);
  return job.data.id;
}

test("three missed bills close a building, warnings precede closure, and abandonment preserves it", () => {
  const { world, clock, config } = lifecycleWorld();
  const id = build(world);
  advance(world, clock, 80);
  const building = world.requireBuilding(id);
  assert.equal(building.status, "DELINQUENT");
  assert.equal(building.missedUpkeepIntervals, 1);
  const warning = world.history.find((event) => event.type === "BUILDING_LIFECYCLE_WARNING");
  assert.equal(warning.data.nextStatus, "INACTIVE");
  assert.equal(warning.data.transitionAt, world.nextUpkeepAt(building));
  assert.ok(world.getPendingNotificationEvents("owner").some((event) => event.data.buildingId === id));
  const blocked = world.getObservation("owner").opportunities.find((action) => action.type === "reactivate_building");
  assert.deepEqual(blocked.blockedBy, ["INSUFFICIENT_CREDITS"]);
  const before = world.history.length;
  assert.throws(() => world.reactivateBuilding("owner", id), (error) => error.code === "INSUFFICIENT_CREDITS");
  assert.equal(world.history.length, before, "failed recovery changes neither money nor state");

  clock.advanceGameMinutes(60);
  assert.throws(() => world.reactivateBuilding("owner", id), (error) => error.code === "UPKEEP_SETTLEMENT_PENDING",
    "a command cannot bypass a due timer before the scheduler catches up");
  world.advanceTo(clock.now());
  assert.equal(building.status, "INACTIVE");
  assert.equal(world.history.filter((event) => event.type === "BUILDING_LIFECYCLE_WARNING").at(-1).data.nextStatus, "CLOSED");
  advance(world, clock, 60);
  assert.equal(building.status, "CLOSED");
  assert.equal(world.nextUpkeepAt(building), null, "closure stops further charges");
  assert.throws(() => world.reactivateBuilding("owner", id), (error) => error.code === "BUILDING_NOT_RECOVERABLE");
  advance(world, clock, 120);
  assert.equal(building.status, "ABANDONED");
  assert.equal(world.state.plots.get("plot-06-05").buildingId, id);
  assert.ok(world.state.locations.has(building.locationId));
  assert.equal(world.state.characters.get("owner").credits, 0);
  assert.equal(building.lifetimeUpkeepFailures, 3);
  assert.equal(world.history.filter((event) => event.type === "BUILDING_UPKEEP_DUE").length, 3);
  assert.equal([...world.state.notifications.values()].filter((item) => item.buildingId === id && item.status === "queued").length, 0);

  const metrics = world.getProductMetrics({ environment: "test", isTest: true }).buildings;
  assert.deepEqual(metrics.upkeepCoverageRate, { numerator: 0, denominator: 3, value: 0 });
  assert.deepEqual(metrics.lifecycleWorldMinutes, { ACTIVE: 60, DELINQUENT: 60, INACTIVE: 60, CLOSED: 120, ABANDONED: 0 });
  assert.equal(metrics.warnings, 2);
  const windowed = world.getProductMetrics({
    fromWorldTime: "2042-05-01T11:40:00.000Z", throughWorldTime: "2042-05-01T14:20:00.000Z",
    environment: "test", isTest: true,
  }).buildings;
  assert.deepEqual(windowed.lifecycleWorldMinutes, { ACTIVE: 0, DELINQUENT: 40, INACTIVE: 60, CLOSED: 60, ABANDONED: 0 });
  const replayed = new World({ store: new InMemoryEventStore(world.history), config, clock });
  assert.deepEqual(replayed.requireBuilding(id), building);
  const count = replayed.history.length;
  replayed.advanceTo(clock.now());
  assert.equal(replayed.history.length, count, "restart never repeats a charge or terminal transition");
});

test("recovery is an offered idempotent payment, preserves failures, and starts a new due interval", () => {
  const { world, clock, config } = lifecycleWorld();
  const id = build(world);
  advance(world, clock, 20);
  earnLater(world, 90);
  advance(world, clock, 90);
  const building = world.requireBuilding(id);
  assert.equal(building.status, "DELINQUENT");
  assert.equal(building.lifetimeUpkeepFailures, 1);
  const observation = world.getObservation("owner");
  const offered = observation.availableActions.find((action) => action.type === "reactivate_building");
  assert.equal(offered.recoveryCost, 1);
  assert.equal(offered.availableCredits, 10);
  world.createCharacter({ id: "other", name: "Other", locationId: "square", credits: 10 });
  const privateView = world.inspectContext("owner", { resource: "buildings" }).items.find((item) => item.id === id);
  assert.equal(privateView.recoveryCost, 1);
  assert.equal(privateView.availableCredits, 10);
  assert.equal(privateView.nextUpkeepAt, world.nextUpkeepAt(building));
  assert.equal(privateView.lifetimeUpkeepFailures, 1);
  const publicView = world.inspectContext("other", { resource: "buildings" }).items.find((item) => item.id === id);
  assert.equal(publicView.status, "DELINQUENT");
  for (const field of ["recoveryCost", "availableCredits", "revenue", "upkeepPaid", "nextUpkeepAt", "lifetimeUpkeepFailures"]) {
    assert.equal(publicView[field], undefined, `${field} is private to the proprietor`);
  }
  assert.ok(!world.getObservation("other").opportunities.some((action) => action.type === "reactivate_building"));
  assert.throws(() => world.reactivateBuilding("other", id), (error) => error.code === "NOT_PROPRIETOR");
  assert.equal(world.state.characters.get("other").credits, 10);
  const action = validateAction({ type: "reactivate_building", buildingId: id }, observation);
  const receipt = world.executeAgentAction("owner", action, "recovery-1");
  assert.deepEqual(world.executeAgentAction("owner", action, "recovery-1"), receipt);
  assert.equal(building.status, "ACTIVE");
  assert.equal(building.missedUpkeepIntervals, 0);
  assert.equal(building.lifetimeUpkeepFailures, 1);
  assert.equal(world.state.characters.get("owner").credits, 9);
  assert.equal(receipt.nextUpkeepAt, "2042-05-01T12:50:00.000Z");
  assert.equal(world.history.filter((event) => event.type === "BUILDING_REACTIVATED").length, 1);
  const replayed = new World({ store: new InMemoryEventStore(world.history), config, clock });
  assert.deepEqual(replayed.requireBuilding(id), building);
  assert.equal(replayed.state.characters.get("owner").credits, 9);
  const metrics = world.getProductMetrics({ environment: "test", isTest: true }).buildings;
  assert.equal(metrics.recoveryPayments, 1);
  assert.equal(metrics.upkeepDue, 1, "an optional recovery payment is not a second scheduled bill");
});

test("lifecycle terms are validated and frozen for each new building", () => {
  assert.throws(() => makeConfig({ city: { upkeepIntervalWorldMinutes: 0 } }), /Invalid building lifecycle/);
  assert.throws(() => makeConfig({ city: { closedAfterMissedUpkeepIntervals: 2 } }), /Invalid building lifecycle/);
  const { world, clock } = lifecycleWorld();
  const id = build(world);
  advance(world, clock, 20);
  const replayed = new World({ store: new InMemoryEventStore(world.history), config: makeConfig(), clock });
  assert.equal(replayed.nextUpkeepAt(replayed.requireBuilding(id)), "2042-05-01T11:20:00.000Z");
  assert.equal(replayed.buildingLifecycleView(replayed.requireBuilding(id)).upkeepIntervalWorldMinutes, 60);
});

test("overdue recovery orders wages and upkeep by world time, with obligations winning a tie", () => {
  const { world, clock, config } = lifecycleWorld();
  const id = build(world);
  advance(world, clock, 20);
  earnLater(world, 120);
  const saved = structuredClone(world.history);
  advance(world, clock, 120);
  const failed = world.history.find((event) => event.type === "BUILDING_UPKEEP_FAILED");
  const completed = world.history.find((event) => event.type === "JOB_COMPLETED");
  const paid = world.history.find((event) => event.type === "BUILDING_UPKEEP_PAID");
  assert.equal(failed.worldTime, "2042-05-01T11:20:00.000Z");
  assert.ok(failed.sequence < completed.sequence, "a future wage cannot pay an earlier bill");
  assert.equal(completed.worldTime, paid.worldTime);
  assert.ok(completed.sequence < paid.sequence, "a same-instant wage settles before upkeep");
  assert.equal(world.requireBuilding(id).status, "ACTIVE");
  assert.equal(world.state.characters.get("owner").credits, 9);
  const restarted = new World({ store: new InMemoryEventStore(saved), config, clock, random: () => 0.5 });
  restarted.advanceTo(clock.now());
  assert.equal(restarted.requireBuilding(id).lifetimeUpkeepFailures, 1);
  assert.equal(restarted.requireBuilding(id).status, "ACTIVE");
  assert.equal(restarted.state.characters.get("owner").credits, 9);
});

test("legacy land replays its cost and ownership and only its buyer may build on it", () => {
  const { world, clock, config } = lifecycleWorld(1000);
  world.createCharacter({ id: "other", name: "Other", locationId: "square", credits: 1000 });
  world.record("PLOT_ACQUIRED", {
    actorCharacterId: "owner",
    data: { plotId: "plot-06-05", x: 6, y: 5, ownerId: "owner", price: 150, cityGridVersion: 1 },
  });
  const replayed = new World({ store: new InMemoryEventStore(world.history), config, clock });
  assert.equal(replayed.state.characters.get("owner").credits, 850);
  assert.equal(replayed.state.creditsRetired, 150);
  assert.equal(replayed.plotView(6, 5, "owner").available, true);
  assert.deepEqual(replayed.plotView(6, 5, "other").blockers, ["PLOT_OWNED"]);
  assert.throws(() => replayed.constructBuilding("other", {
    x: 6, y: 5, name: "Taking old land", profile: { music: 100 }, capabilities: ["host_event"],
  }), (error) => error.code === "PLOT_OWNED");
  const id = build(replayed);
  assert.equal(replayed.state.characters.get("owner").credits, 350, "no second land charge");
  assert.equal(replayed.requireBuilding(id).grammarPolicyVersion, 3);
  assert.equal(replayed.requireBuilding(id).groundClaimMode, "atomic_with_construction");
});

test("legacy upkeep failures remain evidence but receive a fresh version-1 closure grace", () => {
  const { world, clock, config } = lifecycleWorld();
  const id = build(world);
  advance(world, clock, 20);
  for (let index = 0; index < 5; index += 1) {
    clock.advanceGameMinutes(60);
    world.record("BUILDING_UPKEEP_FAILED", {
      actorCharacterId: "owner",
      data: { buildingId: id, proprietorId: "owner", amount: 1, fromProprietor: 0, shortfall: 1, chargedAt: clock.now().toISOString() },
    });
  }
  const history = structuredClone(world.history);
  for (const event of history.filter((item) => ["BUILDING_CONSTRUCTION_STARTED", "BUILDING_ACTIVATED"].includes(item.type))) {
    delete event.data.lifecyclePolicyVersion;
    delete event.data.lifecycleTerms;
  }
  const replayed = new World({ store: new InMemoryEventStore(history), config, clock });
  assert.equal(replayed.requireBuilding(id).lifetimeUpkeepFailures, 5);
  advance(replayed, clock, 60);
  assert.equal(replayed.requireBuilding(id).status, "DELINQUENT", "old failures do not trigger an unannounced immediate closure");
  assert.equal(replayed.requireBuilding(id).missedUpkeepIntervals, 1);
  assert.equal(replayed.requireBuilding(id).lifetimeUpkeepFailures, 6);
  advance(replayed, clock, 60);
  assert.equal(replayed.requireBuilding(id).status, "INACTIVE");
  assert.ok(replayed.history.some((event) => event.type === "BUILDING_LIFECYCLE_WARNING" && event.data.nextStatus === "CLOSED"));
});

test("closure blocks new sales and hiring but settles existing attendance, work, tuition and commitments", () => {
  const { world, clock } = lifecycleWorld(1000);
  const id = build(world);
  advance(world, clock, 20);
  const building = world.requireBuilding(id);
  for (const actor of ["guest", "worker", "student", "late"]) {
    world.createCharacter({ id: actor, name: actor, locationId: "square", credits: 100 });
  }
  const role = world.publishRole("owner", {
    buildingId: id, boardLocationId: "square", title: "Keep the room", durationGameMinutes: 240, wage: 100,
  });
  const application = world.applyForRole("worker", role.data.id);
  world.selectApplicant("owner", role.data.id, application.data.applicationId);
  const openRole = world.publishRole("owner", {
    buildingId: id, boardLocationId: "square", title: "Another role", durationGameMinutes: 30, wage: 20,
  });
  const waitingApplication = world.applyForRole("late", openRole.data.id);
  const course = world.offerResidentCourse("owner", {
    buildingId: id, boardLocationId: "square", catalogEntryId: "foundations", skill: "technical", price: 40, title: "Basics",
  });
  world.enrollInCourse("student", course.data.id);
  const evening = world.hostExperience("owner", { buildingId: id, title: "The last night", durationGameMinutes: 300, accessPrice: 10 });
  const invitation = world.sendInvitation("owner", "guest", { destinationType: "event", destinationId: evening.data.id, message: "Meet here" });
  world.respondToInvitation("guest", invitation.data.invitationId, "accept");
  for (const actor of ["guest", "worker", "student"]) world.startMove(actor, building.locationId);
  advance(world, clock, 10);
  world.startJob("worker", role.data.id);
  world.joinExperience("guest", evening.data.id, { expectedHappiness: 5 });
  world.createJob({
    creatorId: "owner", title: "Reserved funds", locationId: "square", durationGameMinutes: 10,
    compensation: world.state.characters.get("owner").credits,
    offerExpiresAt: "2042-05-02T10:00:00.000Z",
  });
  advance(world, clock, 50);
  assert.equal(building.status, "DELINQUENT");
  assert.throws(() => world.applyForRole("student", openRole.data.id), (error) => error.code === "BUILDING_NOT_ACTIVE");
  assert.throws(() => world.selectApplicant("owner", openRole.data.id, waitingApplication.data.applicationId),
    (error) => error.code === "CANDIDATE_NO_LONGER_ELIGIBLE" && error.details.blockingCodes.includes("BUILDING_NOT_ACTIVE"));
  assert.equal(world.state.jobs.get(openRole.data.id).escrow, 20);
  assert.ok(world.getObservation("owner").availableActions.some((action) =>
    action.type === "cancel_job" && action.jobId === openRole.data.id),
  "the proprietor can still cancel an open funded role through the original escrow policy");
  const lateCredits = world.state.characters.get("late").credits;
  assert.throws(() => world.enrollInCourse("late", course.data.id), (error) => error.code === "BUILDING_NOT_ACTIVE");
  assert.throws(() => world.joinExperience("late", evening.data.id), (error) => error.code === "BUILDING_NOT_ACTIVE");
  assert.equal(world.state.characters.get("late").credits, lateCredits);
  assert.equal(world.courseEnrollmentFeasibility(world.requireCharacter("late"), world.requireCourse(course.data.id)).blockingCode, "BUILDING_NOT_ACTIVE");
  assert.equal(world.eventAttendanceFeasibility(world.requireCharacter("late"), world.requireGathering(evening.data.id)).blockingCode, "BUILDING_NOT_ACTIVE");
  assert.throws(() => world.hostExperience("owner", { buildingId: id, title: "No", durationGameMinutes: 10 }), (error) => error.code === "BUILDING_NOT_ACTIVE");
  assert.throws(() => world.publishRole("owner", { buildingId: id }), (error) => error.code === "BUILDING_NOT_ACTIVE");
  world.startCourse("student", course.data.id);
  world.startMove("owner", building.locationId);
  advance(world, clock, 120);
  assert.equal(building.status, "CLOSED");
  assert.equal(world.state.jobs.get(role.data.id).status, "running");
  assert.equal(world.state.characters.get("guest").activity.type, "attend_event");
  assert.equal(world.state.characters.get("student").skills.technical, 12);
  assert.ok([...world.state.commitments.values()].some((commitment) => commitment.status === "kept"));
  advance(world, clock, 130);
  assert.equal(building.status, "ABANDONED");
  assert.equal(world.state.jobs.get(role.data.id).status, "completed");
  assert.equal(world.state.characters.get("worker").credits, 200);
  assert.equal(world.history.filter((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED" && event.actorCharacterId === "guest").length, 1);
  assert.equal(world.history.filter((event) => event.type === "JOB_ESCROW_SETTLED" && event.data.jobId === role.data.id).length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

// AIT-1603. A resident-created role is filled by application and selection: the candidate
// stays their own agent, the proprietor keeps the choice, and reputation is what the choice
// is made on. These tests pin that contract end to end.

function hiringWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  let nextId = 1;
  const store = new InMemoryEventStore();
  const world = new World({
    store, config, clock, idGenerator: () => `hire-${nextId++}`, random: () => 0.5,
  });
  world.defineLocation({ id: "square", name: "The Square", x: 5, y: 5 });
  world.bootstrapEconomy({ budgetId: "budget", credits: 1_000_000 });
  world.createCharacter({
    id: "luca", name: "Luca", locationId: "square", credits: 3_000,
    personality: [], goal: "Run a venue.", skills: {},
  });
  const built = world.constructBuilding("luca", {
    x: 6, y: 6, width: 1, height: 1, name: "The Hole", description: "A venue.",
    profile: { music: 40 }, capabilities: ["host_event", "create_job"],
  });
  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());
  world.fundBuilding("luca", built.data.buildingId, 500);
  for (const [id, skills] of [["ana", { social: 40 }], ["bo", { social: 40 }], ["cyn", { social: 5 }]]) {
    world.createCharacter({
      id, name: id, locationId: "square", credits: 100,
      personality: [], goal: "Find work.", skills,
    });
  }
  return { world, clock, config, store, buildingId: built.data.buildingId };
}

function publishDoorRole(world, buildingId, overrides = {}) {
  return world.publishRole("luca", {
    buildingId, boardLocationId: "square", title: "Work the door",
    description: "Check the list.", requirements: { social: 20 },
    durationGameMinutes: 20, wage: 40, ...overrides,
  });
}

test("applying is validated where the notice hangs, and never controlled by the proprietor", () => {
  const { world, buildingId } = hiringWorld();
  const role = publishDoorRole(world, buildingId);

  assert.throws(() => world.applyForRole("luca", role.data.id),
    (error) => error instanceof DomainError && error.code === "SELF_EMPLOYMENT");
  assert.throws(() => world.applyForRole("cyn", role.data.id),
    (error) => error instanceof DomainError && error.code === "SKILL_REQUIREMENT");
  world.defineLocation({ id: "elsewhere", name: "Elsewhere", x: 9, y: 9 });
  world.createCharacter({
    id: "far", name: "Far", locationId: "elsewhere", credits: 0, personality: [], goal: "Work.",
    skills: { social: 50 },
  });
  assert.throws(() => world.applyForRole("far", role.data.id),
    (error) => error instanceof DomainError && error.code === "WRONG_LOCATION",
    "an application is made at the board where the notice hangs");

  world.applyForRole("ana", role.data.id);
  assert.throws(() => world.applyForRole("ana", role.data.id),
    (error) => error instanceof DomainError && error.code === "ALREADY_APPLIED");

  // The proprietor is interrupted the way an invitation interrupts: a selection nobody is
  // prompted for is a role that quietly expires.
  const prompt = [...world.state.notifications.values()].find((notification) =>
    notification.characterId === "luca" && notification.compatibleActions.includes("select_applicant"));
  assert.ok(prompt, "the application reaches the proprietor's brain");
});

test("selection commits exactly one applicant, answers the rest, and pays through the normal escrow", () => {
  const { world, clock, buildingId } = hiringWorld();
  const role = publishDoorRole(world, buildingId);
  world.applyForRole("ana", role.data.id);
  world.applyForRole("bo", role.data.id);

  const desk = world.getObservation("luca").availableActions
    .find((action) => action.type === "select_applicant" && action.jobId === role.data.id);
  assert.equal(desk.applications.length, 2);
  for (const application of desk.applications) {
    assert.equal(typeof application.reputation.general, "number",
      "the chooser reads a verified public track record");
    assert.ok(application.reputation.domains.social !== undefined,
      "in the domains the role names");
    assert.equal(application.skills, undefined, "and never the candidate's private sheet");
    assert.equal(application.score, undefined, "the server ranks nobody");
  }

  const chosen = desk.applications.find((application) => application.candidateId === "bo");
  const accepted = world.selectApplicant("luca", role.data.id, chosen.applicationId);
  assert.equal(accepted.type, "JOB_ACCEPTED");
  assert.deepEqual(world.state.jobs.get(role.data.id).workerIds, ["bo"]);
  const rejection = world.history.find((event) => event.type === "BUILDING_ROLE_CANDIDATE_REJECTED");
  assert.equal(rejection.data.characterId, "ana");
  assert.equal(rejection.data.cause, "another_candidate_selected");
  const selectedNotice = [...world.state.notifications.values()].find((notification) =>
    notification.characterId === "bo" && notification.compatibleActions.includes("start_job"));
  assert.ok(selectedNotice, "the selected candidate is told to turn up");

  // The commitment behaves like any accepted job: walk in through the shut door, start,
  // complete, and the reserved wage settles from the building's purse exactly once.
  const building = () => world.state.buildings.get(buildingId);
  const reservedBalance = building().balance;
  world.startMove("bo", building().locationId);
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  world.startJob("bo", role.data.id);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  assert.equal(world.getObservation("bo").character.credits, 100 + 40, "the building paid the wage");
  assert.equal(building().balance, reservedBalance, "and only the reservation moved");
});

test("a stale selection fails loudly, loses no escrow, and leaves the choice open", () => {
  const { world, buildingId } = hiringWorld();
  const role = publishDoorRole(world, buildingId);
  world.createSystemJob({
    budgetId: "budget", id: "distraction", title: "Other work", locationId: "square",
    durationGameMinutes: 30, compensation: 30,
  });
  world.applyForRole("ana", role.data.id);
  world.applyForRole("bo", role.data.id);

  // Ana commits elsewhere between applying and being chosen.
  world.acceptJob("ana", "distraction");
  const desk = () => world.getObservation("luca").availableActions
    .find((action) => action.type === "select_applicant" && action.jobId === role.data.id);
  const anaRow = desk().applications.find((application) => application.candidateId === "ana");
  assert.equal(anaRow.stillEligible, false, "the row already says the pick would fail");
  assert.ok(anaRow.blockingCodes.includes("JOB_COMMITMENT_CONFLICT"));

  assert.throws(() => world.selectApplicant("luca", role.data.id, anaRow.applicationId),
    (error) => error instanceof DomainError && error.code === "CANDIDATE_NO_LONGER_ELIGIBLE");
  const job = world.state.jobs.get(role.data.id);
  assert.equal(job.status, "open", "a failed selection changes nothing");
  assert.equal(job.reservation.state, "reserved", "and duplicates or loses no escrow");

  const boRow = desk().applications.find((application) => application.candidateId === "bo");
  assert.equal(world.selectApplicant("luca", role.data.id, boRow.applicationId).type, "JOB_ACCEPTED");
});

test("withdrawal is the candidate's own act and the whole hiring story replays", () => {
  const { world, buildingId, config, store, clock } = hiringWorld();
  const role = publishDoorRole(world, buildingId);
  const application = world.applyForRole("ana", role.data.id);
  world.withdrawApplication("ana", role.data.id);
  assert.throws(() => world.selectApplicant("luca", role.data.id, application.data.applicationId),
    (error) => error instanceof DomainError && error.code === "APPLICATION_NOT_PENDING");

  world.applyForRole("bo", role.data.id);
  const desk = world.getObservation("luca").availableActions
    .find((action) => action.type === "select_applicant");
  world.selectApplicant("luca", role.data.id, desk.applications[0].applicationId);

  const replayed = new World({ store, config, clock });
  assert.deepEqual(
    replayed.state.jobs.get(role.data.id).applications,
    world.state.jobs.get(role.data.id).applications,
    "application, withdrawal, selection and rejection all fold back from the log",
  );
});

test("a role can demand a track record, which only verified outcomes can supply", () => {
  const { world, clock, buildingId, config } = hiringWorld();
  // Ana earns a social track record the only way one can be earned.
  world.createSystemJob({
    budgetId: "budget", id: "greeting", title: "Greet the square", locationId: "square",
    durationGameMinutes: 10, compensation: 20, requirements: { social: 30 },
  });
  world.acceptJob("ana", "greeting");
  world.startJob("ana", "greeting");
  clock.advanceGameMinutes(10);
  world.advanceTo(clock.now());
  const earned = world.getObservation("ana").character.domainReputation.social;
  assert.ok(earned > 0, "the fixture needs a real track record");

  const role = publishDoorRole(world, buildingId, {
    id: "picky-door", reputationRequirements: { social: earned },
  });
  const notice = (characterId) => {
    const observation = world.getObservation(characterId);
    return [...observation.availableActions, ...observation.opportunities]
      .find((action) => action.type === "apply_for_role" && action.jobId === role.data.id);
  };
  assert.deepEqual(notice("bo").reputationRequirements, { social: earned },
    "the demanded record is on the notice, not discovered by refusal");
  assert.ok(notice("bo").blockedBy?.includes("REPUTATION_REQUIREMENT")
    ?? notice("bo").feasibility?.blockingCodes.includes("REPUTATION_REQUIREMENT"),
  "a candidate without the record sees exactly what stands in the way");
  assert.throws(() => world.applyForRole("bo", role.data.id),
    (error) => error instanceof DomainError && error.code === "REPUTATION_REQUIREMENT");
  assert.equal(world.applyForRole("ana", role.data.id).type, "BUILDING_ROLE_APPLIED",
    "the record she demonstrated opens the door");

  // The domain vocabulary is controlled: a proprietor cannot invent one.
  assert.throws(() => publishDoorRole(world, buildingId, {
    id: "invented-domain", reputationRequirements: { charisma: 10 },
  }), (error) => error instanceof DomainError && error.code === "UNKNOWN_REPUTATION_DOMAIN");
  assert.ok(config.skills.set.length > 0);
});

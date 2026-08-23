import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { activateWorldConfiguration, loadWorldConfiguration } from "../src/config/world-configuration.js";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";
import { settleEveryone } from "./support/pilot.js";

// The three stories assembled end to end through the real World, because twice before parts
// that each passed their own tests did not connect. Courses create difference, reputation
// makes it visible, hiring reads it - one unbroken chain, no seams crossed by hand.

test("the gap the pilot exposed closes: a seeded course buys a way into work no board taught", () => {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config, clock, random: () => 0.5 });
  activateWorldConfiguration(world, loadWorldConfiguration(resolve("config/world.local-5.json")));
  settleEveryone(world);

  // Nia stands at Foundry Square. The business work there demands 40; she carries 30, and
  // no post within reach teaches business at her level. This is the exact resident the
  // handoff named, one rung below everything.
  const nia = () => world.getObservation("pilot-03");
  assert.equal(nia().character.locationId, "foundry");
  const blocked = nia().opportunities.find((entry) => entry.jobId === "supply-handoff");
  assert.ok(blocked, "the better post is on the map");
  assert.deepEqual(blocked.blockedBy, ["SKILL_REQUIREMENT"], "blocked by the skill alone");

  // The board now also carries a course, and its notice states the whole bargain.
  const notice = nia().availableActions.find((action) => action.type === "enroll_course");
  assert.ok(notice, "the way in is on the same board as the work it opens");
  assert.equal(notice.effects[0].skill, "business");
  const projected = notice.effects[0].value;
  assert.ok(projected >= blocked.requirements.business,
    "the disclosed effect is enough to cross the rung that blocked her");

  world.enrollInCourse("pilot-03", notice.courseId);
  world.startCourse("pilot-03", notice.courseId);
  clock.advanceGameMinutes(notice.durationGameMinutes);
  world.advanceTo(clock.now());
  assert.equal(nia().character.skills.business, projected, "the course delivered what it sold");

  // The rung is now a job: accept it, work it, get paid, and the completion writes the
  // first line of a business track record.
  const opened = nia().availableActions.find((action) => action.jobId === "supply-handoff");
  assert.ok(opened, "the post moved from the map to the menu");
  world.acceptJob("pilot-03", "supply-handoff");
  world.startJob("pilot-03", "supply-handoff");
  clock.advanceGameMinutes(opened.durationGameMinutes);
  world.advanceTo(clock.now());
  assert.ok(nia().character.domainReputation.business > 0,
    "verified work in the domain the course opened");
});

test("the whole loop: a resident teaches, a student pays the building, the building hires on reputation", () => {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config, clock, random: () => 0.5 });
  world.defineLocation({ id: "square", name: "The Square", x: 5, y: 5 });
  world.bootstrapEconomy({ budgetId: "budget", credits: 50_000 });
  world.createCharacter({
    id: "kai", name: "Kai", locationId: "square", credits: 3_000,
    personality: ["Meticulous"], goal: "Master a craft.", skills: { creativity: 90, technical: 60 },
  });
  for (const [id, skills] of [["ana", { social: 45 }], ["bo", { social: 45 }]]) {
    world.createCharacter({
      id, name: id, locationId: "square", credits: 200, personality: [], goal: "Get on.", skills,
    });
  }

  // Money is conserved through every step below, or the loop is an illusion.
  const conserved = (what) => {
    const { overview } = world.getPublicState();
    const supply = overview.moneySupply + overview.systemBudgetBalance;
    const held = overview.characterCredits
      + overview.reservedCredits + overview.systemBudgetBalance;
    assert.equal(held, supply, `credits went missing or appeared ${what}`);
  };

  // Kai builds a workshop that can host, teach, and employ.
  const built = world.constructBuilding("kai", {
    x: 6, y: 6, width: 1, height: 1, name: "Kai's Workshop", description: "Made to last.",
    profile: { learning: 40, creativity: 30 }, capabilities: ["host_event", "create_job", "sell_service"],
  });
  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());
  const buildingId = built.data.buildingId;
  const building = () => world.state.buildings.get(buildingId);
  conserved("after construction");

  // He teaches: tuition is the building's second income after admission.
  const entry = config.courses.catalog.find((item) => item.id === "foundations");
  const offered = world.offerResidentCourse("kai", {
    buildingId, boardLocationId: "square", catalogEntryId: "foundations",
    skill: "social", price: entry.priceMinimum, title: "Working a room",
  });
  const kaiBeforeTuition = world.getObservation("kai").character.credits;
  world.enrollInCourse("ana", offered.data.id);
  assert.equal(world.getObservation("kai").character.credits, kaiBeforeTuition + entry.priceMinimum,
    "tuition is paid straight to the proprietor");
  assert.equal(building().revenue, entry.priceMinimum, "and recorded as the venue's revenue");
  conserved("after tuition");
  world.startMove("ana", building().locationId);
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  world.startCourse("ana", offered.data.id);
  clock.advanceGameMinutes(entry.durationGameMinutes);
  world.advanceTo(clock.now());

  // Bo meanwhile earns a social track record the only way one is earned: verified work.
  world.createSystemJob({
    budgetId: "budget", id: "greeting", title: "Greet the square", locationId: "square",
    durationGameMinutes: 10, compensation: 20, requirements: { social: 40 },
  });
  world.acceptJob("bo", "greeting");
  world.startJob("bo", "greeting");
  clock.advanceGameMinutes(10);
  world.advanceTo(clock.now());
  conserved("after the reputation-building job");

  // The proprietor pays a wage out of his own wallet - the takings from teaching and
  // hosting are already in it; the notice hangs in the square; both residents apply.
  const role = world.publishRole("kai", {
    buildingId, boardLocationId: "square", title: "Front of house",
    description: "Welcome the guests.", requirements: { social: 40 },
    durationGameMinutes: 20, wage: 50,
  });
  world.startMove("ana", "square");
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  world.applyForRole("ana", role.data.id);
  world.applyForRole("bo", role.data.id);
  conserved("with the wage in escrow");

  // Kai reads the applications: same skills on paper, different demonstrated records. The
  // server states the facts; the choice is his.
  const desk = world.getObservation("kai").availableActions
    .find((action) => action.type === "select_applicant" && action.jobId === role.data.id);
  const rows = Object.fromEntries(desk.applications.map((row) => [row.candidateId, row]));
  assert.ok(rows.bo.reputation.domains.social > rows.ana.reputation.domains.social,
    "the difference reputation exists to make visible");
  world.selectApplicant("kai", role.data.id, rows.bo.applicationId);

  // Bo walks in through the shut door, works, and the reserved wage settles exactly once.
  world.startMove("bo", building().locationId);
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  world.startJob("bo", role.data.id);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  assert.equal(world.state.jobs.get(role.data.id).status, "completed");
  assert.equal(world.getObservation("bo").character.credits, 200 + 20 + 50,
    "wages from the city and from the building both arrived");
  conserved("after the wage settled");

  // And the hire itself fed back into the record it was made on.
  assert.ok(world.getObservation("bo").character.domainReputation.social
    > rows.bo.reputation.domains.social, "working the role deepened the track record");
});

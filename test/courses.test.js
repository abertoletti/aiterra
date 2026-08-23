import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

// AIT-1205. These tests pin the rules of the course and skill progression policy, not the
// calibration: a retuned price or gain must not fail them, a broken idea must.

function courseWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  let nextId = 1;
  const store = new InMemoryEventStore();
  const world = new World({
    store, config, clock, idGenerator: () => `course-${nextId++}`, random: () => 0.5,
  });
  world.defineLocation({ id: "square", name: "The Square", x: 5, y: 5 });
  world.bootstrapEconomy({ budgetId: "budget", credits: 100_000 });
  world.createCharacter({
    id: "nia", name: "Nia", locationId: "square", credits: 500,
    personality: ["Impulsive"], goal: "Climb.",
    skills: { social: 60, business: 30, creativity: 85, technical: 15 },
  });
  return { world, clock, config, store };
}

function seedFoundations(world, overrides = {}) {
  const entry = world.config.courses.catalog.find((item) => item.id === "foundations");
  return {
    entry,
    course: world.offerCourse({
      id: "tech-foundations", providerType: "city", providerId: "budget",
      locationId: "square", boardLocationId: "square",
      catalogEntryId: "foundations", skill: "technical",
      price: entry.priceMinimum, title: "Foundry basics", ...overrides,
    }),
  };
}

test("the notice discloses provider, terms, prerequisites and exact effects before a credit moves", () => {
  const { world } = courseWorld();
  const { entry } = seedFoundations(world);

  const notice = world.getObservation("nia").availableActions
    .find((action) => action.type === "enroll_course");
  assert.ok(notice, "an affordable, feasible course sits in the menu");
  for (const field of ["providerType", "providerId", "locationId", "price", "durationGameMinutes",
    "energyCost", "prerequisites", "effects", "schedule", "tuition"]) {
    assert.notEqual(notice[field], undefined, `the notice must disclose ${field}, or the agent is taught to guess`);
  }
  // The effects are exact for THIS reader: the gain is the catalog's, clamped at the ceiling.
  const effect = notice.effects.find((item) => item.skill === "technical");
  assert.equal(effect.previous, 15);
  assert.equal(effect.delta, Math.min(entry.gain, entry.teachesTo - 15));
  assert.equal(effect.value, effect.previous + effect.delta);
  assert.ok(effect.value <= entry.teachesTo, "a course never teaches past its own ceiling");
  // Every exit is priced before entry: no refund path is left to be discovered by refusal.
  assert.equal(notice.tuition.refundOnCancel, 0);
  assert.equal(notice.tuition.refundOnAbandon, 0);
  assert.equal(notice.tuition.refundOnNoShow, 0);
});

test("enrolment pays exactly once and atomically; a refusal charges nothing", () => {
  const { world } = courseWorld();
  const { course } = seedFoundations(world);
  world.createCharacter({
    id: "pauper", name: "Pauper", locationId: "square", credits: 1,
    personality: [], goal: "Learn.", skills: {},
  });

  assert.throws(() => world.enrollInCourse("pauper", course.data.id),
    (error) => error instanceof DomainError && error.code === "INSUFFICIENT_CREDITS");
  const pauper = world.getObservation("pauper").character;
  assert.equal(pauper.credits, 1, "a rejected enrolment moves no money");
  assert.equal([...world.state.courseEnrollments.values()].length, 0, "and creates no commitment");

  const before = world.getObservation("nia").character.credits;
  world.enrollInCourse("nia", course.data.id);
  const after = world.getObservation("nia").character;
  assert.equal(after.credits, before - course.data.price, "tuition moved with the seat");
  assert.equal(after.wallet.opening + after.wallet.earned - after.wallet.spent, after.credits,
    "the wallet identity survives tuition");

  assert.throws(() => world.enrollInCourse("nia", course.data.id),
    (error) => error instanceof DomainError && error.code === "ENROLLMENT_CONFLICT");
  assert.equal(world.getObservation("nia").character.credits, before - course.data.price,
    "a duplicate submission cannot charge twice");
});

test("a course is a timed primary activity whose effects apply exactly once, at completion", () => {
  const { world, clock } = courseWorld();
  const { course } = seedFoundations(world);
  world.enrollInCourse("nia", course.data.id);

  const energyBefore = world.getObservation("nia").character.energy;
  world.startCourse("nia", course.data.id);
  const during = world.getObservation("nia").character;
  assert.equal(during.activity.type, "course");
  assert.equal(during.energy, energyBefore - course.data.energyCost, "the disclosed Energy is charged at the start");
  assert.equal(during.skills.technical, 15, "nothing is granted before completion");

  clock.advanceGameMinutes(course.data.durationGameMinutes);
  world.advanceTo(clock.now());
  const graduated = world.getObservation("nia").character;
  const completed = world.history.find((event) => event.type === "COURSE_COMPLETED");
  assert.ok(completed, "completion is a recorded fact");
  const effect = completed.data.effects.find((item) => item.skill === "technical");
  assert.equal(graduated.skills.technical, effect.value, "the applied effect is the disclosed one");
  assert.equal(graduated.activity, null);

  // A second pass of the timer cannot apply a second dose.
  clock.advanceGameMinutes(course.data.durationGameMinutes);
  world.advanceTo(clock.now());
  assert.equal(world.getObservation("nia").character.skills.technical, effect.value);
  assert.equal(world.history.filter((event) => event.type === "COURSE_COMPLETED").length, 1);
});

test("cancelling, abandoning mid-class, and missing the window all forfeit the tuition and grant nothing", () => {
  const { world, clock } = courseWorld();
  const { course } = seedFoundations(world);
  const credits = () => world.getObservation("nia").character.credits;
  const technical = () => world.getObservation("nia").character.skills.technical;

  // Cancel before start.
  const beforeCancel = credits();
  world.enrollInCourse("nia", course.data.id);
  world.abandonCourse("nia", course.data.id);
  assert.equal(credits(), beforeCancel - course.data.price, "the disclosed rule: no refund");
  assert.equal(technical(), 15);

  // Walk out of class.
  world.enrollInCourse("nia", course.data.id);
  world.startCourse("nia", course.data.id);
  world.abandonCourse("nia", course.data.id);
  assert.equal(technical(), 15, "abandonment grants no undisclosed partial benefit");
  assert.equal(world.getObservation("nia").character.activity, null);

  // Sleep through the start window.
  world.enrollInCourse("nia", course.data.id);
  clock.advanceGameMinutes(world.config.courses.startGraceWorldHours * 60 + 1);
  world.advanceTo(clock.now());
  const noShow = world.history.filter((event) => event.type === "COURSE_ABANDONED").at(-1);
  assert.equal(noShow.data.cause, "start_window_missed");
  assert.equal(technical(), 15);
  // The forfeitures leave the enrolment terminal, so a new attempt is allowed.
  assert.equal(world.enrollInCourse("nia", course.data.id).type, "COURSE_ENROLLED");
});

test("a blocked course stays visible with every blocker named, in the observation and the catalog", () => {
  const { world } = courseWorld();
  const entry = world.config.courses.catalog.find((item) => item.id === "specialization");
  world.offerCourse({
    id: "tech-specialization", providerType: "city", providerId: "budget",
    locationId: "square", boardLocationId: "square",
    catalogEntryId: "specialization", skill: "technical", tradeoffSkill: "social",
    price: entry.priceMinimum, title: "Advanced systems",
  });

  // Nia's technical 15 is below the specialization prerequisite by construction of the
  // catalog: the two entries chain, foundations first.
  assert.ok(15 < entry.prerequisite, "the fixture must sit below the prerequisite");
  const observation = world.getObservation("nia");
  const blocked = observation.opportunities.find((item) => item.type === "enroll_course");
  assert.ok(blocked, "the course is on the map, not hidden");
  assert.ok(blocked.blockedBy.includes("PREREQUISITE_NOT_MET"));

  const catalog = world.inspectContext("nia", { resource: "courses" });
  const item = catalog.items.find((row) => row.courseId === "tech-specialization");
  assert.ok(item, "a requested known course remains visible when it cannot be attended");
  assert.equal(item.feasibility.eligible, false);
  assert.ok(item.feasibility.blockingCodes.includes("PREREQUISITE_NOT_MET"));
  assert.throws(() => world.enrollInCourse("nia", "tech-specialization"),
    (error) => error instanceof DomainError && error.code === "PREREQUISITE_NOT_MET");
});

test("study and work are one commitment: each blocks the other, and both say so", () => {
  const { world } = courseWorld();
  const { course } = seedFoundations(world);
  world.createSystemJob({
    budgetId: "budget", id: "sweep", title: "Sweep", locationId: "square",
    durationGameMinutes: 10, compensation: 12,
  });

  world.createSystemJob({
    budgetId: "budget", id: "sweep-again", title: "Sweep again", locationId: "square",
    durationGameMinutes: 10, compensation: 12,
  });

  world.acceptJob("nia", "sweep");
  assert.throws(() => world.enrollInCourse("nia", course.data.id),
    (error) => error instanceof DomainError && error.code === "JOB_COMMITMENT_CONFLICT");
  world.cancelJob("nia", "sweep");

  world.enrollInCourse("nia", course.data.id);
  assert.throws(() => world.acceptJob("nia", "sweep-again"),
    (error) => error instanceof DomainError && error.code === "COURSE_COMMITMENT_CONFLICT");
});

test("a resident teaches from the approved catalog only, and the tuition is paid to the proprietor", () => {
  const { world, clock } = courseWorld();
  world.createCharacter({
    id: "kai", name: "Kai", locationId: "square", credits: 3_000,
    personality: ["Meticulous"], goal: "Master a craft.",
    skills: { creativity: 90, technical: 60 },
  });
  const built = world.constructBuilding("kai", {
    x: 6, y: 6, width: 1, height: 1, name: "The Workshop", description: "A teaching workshop.",
    profile: { learning: 40 }, capabilities: ["host_event", "sell_service"],
  });
  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());
  const buildingId = built.data.buildingId;
  const entry = world.config.courses.catalog.find((item) => item.id === "foundations");

  // The terms a provider may propose are commercial only; the mechanics are the catalog's.
  assert.throws(() => world.offerResidentCourse("kai", {
    buildingId, boardLocationId: "square", catalogEntryId: "invented-course",
    skill: "creativity", price: entry.priceMinimum, title: "My own rules",
  }), (error) => error instanceof DomainError && error.code === "UNKNOWN_COURSE_TEMPLATE");
  assert.throws(() => world.offerResidentCourse("kai", {
    buildingId, boardLocationId: "square", catalogEntryId: "foundations",
    skill: "creativity", price: entry.priceMaximum + 1, title: "Priced off the band",
  }), (error) => error instanceof DomainError && error.code === "INVALID_COURSE_PRICE");

  const offered = world.offerResidentCourse("kai", {
    buildingId, boardLocationId: "square", catalogEntryId: "foundations",
    skill: "creativity", price: entry.priceMaximum, title: "Craft foundations",
  });
  const building = () => world.state.buildings.get(buildingId);
  const kaiBefore = world.getObservation("kai").character.credits;
  const revenueBefore = building().revenue;
  world.createCharacter({
    id: "ana", name: "Ana", locationId: "square", credits: 400,
    personality: [], goal: "Learn a craft.", skills: { creativity: 10 },
  });
  world.enrollInCourse("ana", offered.data.id);
  assert.equal(world.getObservation("kai").character.credits, kaiBefore + offered.data.price,
    "tuition is paid straight to the proprietor, the way admission is");
  assert.equal(building().revenue, revenueBefore + offered.data.price,
    "and the venue records it as revenue");

  // The building is shut - nothing is on - and the enrolled student still gets in, in the
  // command and in the affordance, because a course nobody can reach sells nothing.
  const move = world.getObservation("ana").availableActions
    .find((action) => action.type === "move" && action.destinationId === building().locationId);
  assert.ok(move, "the walk to a shut classroom sits in the menu for its student");
  world.startMove("ana", building().locationId);
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  world.startCourse("ana", offered.data.id);
  clock.advanceGameMinutes(offered.data.durationGameMinutes);
  world.advanceTo(clock.now());
  assert.ok(world.getObservation("ana").character.skills.creativity > 10, "the class taught what it sold");
});

test("a building without sell_service cannot teach, and a building cannot spam course notices", () => {
  const { world, clock } = courseWorld();
  world.createCharacter({
    id: "kai", name: "Kai", locationId: "square", credits: 5_000,
    personality: [], goal: "Teach.", skills: {},
  });
  const bare = world.constructBuilding("kai", {
    x: 7, y: 7, width: 1, height: 1, name: "The Hall", description: "No services.",
    profile: { music: 30 }, capabilities: ["host_event"],
  });
  const entry = world.config.courses.catalog.find((item) => item.id === "foundations");
  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());
  assert.throws(() => world.offerResidentCourse("kai", {
    buildingId: bare.data.buildingId, boardLocationId: "square", catalogEntryId: "foundations",
    skill: "social", price: entry.priceMinimum, title: "Unlicensed teaching",
  }), (error) => error instanceof DomainError && error.code === "CAPABILITY_MISSING");

  const school = world.constructBuilding("kai", {
    x: 8, y: 8, width: 1, height: 1, name: "The School", description: "A school.",
    profile: { learning: 30 }, capabilities: ["sell_service"],
  });
  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());
  for (let index = 0; index < world.config.courses.maximumOpenCoursesPerBuilding; index += 1) {
    world.offerResidentCourse("kai", {
      buildingId: school.data.buildingId, boardLocationId: "square", catalogEntryId: "foundations",
      skill: "social", price: entry.priceMinimum, title: `Course ${index + 1}`,
    });
  }
  assert.throws(() => world.offerResidentCourse("kai", {
    buildingId: school.data.buildingId, boardLocationId: "square", catalogEntryId: "foundations",
    skill: "social", price: entry.priceMinimum, title: "One too many",
  }), (error) => error instanceof DomainError && error.code === "COURSE_LIMIT_REACHED");
});

test("the first approved catalog carries a positive-only course and a specialization with a disclosed tradeoff", () => {
  const { world, clock } = courseWorld();
  const catalog = world.config.courses.catalog;
  assert.ok(catalog.some((entry) => !entry.tradeoffLoss), "at least one positive-only entry");
  assert.ok(catalog.some((entry) => entry.tradeoffLoss > 0), "at least one disclosed tradeoff entry");

  // The tradeoff is real and applied as disclosed: the target rises, the named skill falls.
  const entry = catalog.find((item) => item.tradeoffLoss > 0);
  world.offerCourse({
    id: "biz-specialization", providerType: "city", providerId: "budget",
    locationId: "square", boardLocationId: "square",
    catalogEntryId: entry.id, skill: "business", tradeoffSkill: "creativity",
    price: entry.priceMinimum, title: "Ledgers, deeply",
  });
  const before = structuredClone(world.getObservation("nia").character.skills);
  world.enrollInCourse("nia", "biz-specialization");
  world.startCourse("nia", "biz-specialization");
  clock.advanceGameMinutes(entry.durationGameMinutes);
  world.advanceTo(clock.now());
  const after = world.getObservation("nia").character.skills;
  assert.ok(after.business > before.business, "the specialization deepened its target");
  assert.equal(after.creativity, before.creativity - entry.tradeoffLoss,
    "and charged exactly the disclosed cost in the named skill");
});

test("a replayed history rebuilds courses, enrolments, and taught skills identically", () => {
  const { world, clock, config, store } = courseWorld();
  const { course } = seedFoundations(world);
  world.enrollInCourse("nia", course.data.id);
  world.startCourse("nia", course.data.id);
  clock.advanceGameMinutes(course.data.durationGameMinutes);
  world.advanceTo(clock.now());

  const replayed = new World({ store, config, clock });
  assert.deepEqual(replayed.state.courses, world.state.courses);
  assert.deepEqual(replayed.state.courseEnrollments, world.state.courseEnrollments);
  assert.deepEqual(
    replayed.getObservation("nia").character.skills,
    world.getObservation("nia").character.skills,
  );
  assert.equal(replayed.getObservation("nia").character.credits, world.getObservation("nia").character.credits);
});

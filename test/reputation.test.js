import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

// AIT-1202. Reputation is a track record written only by verified outcomes. These tests pin
// the rules - attribution, asymmetry, repetition, bounds, provenance - never the deltas.

function reputationWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  let nextId = 1;
  const store = new InMemoryEventStore();
  const world = new World({
    store, config, clock, idGenerator: () => `rep-${nextId++}`, random: () => 0.5,
  });
  world.defineLocation({ id: "square", name: "The Square", x: 5, y: 5 });
  world.bootstrapEconomy({ budgetId: "budget", credits: 1_000_000 });
  world.createCharacter({
    id: "rae", name: "Rae", locationId: "square", credits: 300,
    personality: [], goal: "Work.", skills: { social: 60, technical: 60, business: 60, creativity: 60 },
  });
  return { world, clock, config, store };
}

function seedJob(world, id, { requirements = {}, repeatable = false } = {}) {
  return world.createSystemJob({
    budgetId: "budget", id, title: `Job ${id}`, locationId: "square",
    durationGameMinutes: 10, compensation: 40, requirements,
    repeatable, cooldownGameMinutes: repeatable ? 5 : null,
  });
}

function completeJob(world, clock, characterId, jobId) {
  world.acceptJob(characterId, jobId);
  world.startJob(characterId, jobId);
  clock.advanceGameMinutes(10);
  world.advanceTo(clock.now());
}

const reputationOf = (world, characterId) => {
  const character = world.getObservation(characterId).character;
  return { general: character.reputation, domains: character.domainReputation };
};

test("completed work builds general reputation and exactly the domains the post demanded", () => {
  const { world, clock } = reputationWorld();
  seedJob(world, "skilled", { requirements: { technical: 40 } });
  seedJob(world, "errand");

  completeJob(world, clock, "rae", "skilled");
  let rep = reputationOf(world, "rae");
  assert.ok(rep.general > 0, "a verified completion counts toward general reliability");
  assert.ok(rep.domains.technical > 0, "and toward the demanded domain");
  assert.equal(rep.domains.social ?? 0, 0, "but never toward a domain the work did not prove");

  const generalBefore = rep.general;
  completeJob(world, clock, "rae", "errand");
  rep = reputationOf(world, "rae");
  assert.ok(rep.general > generalBefore, "the errand still proves general reliability");
  assert.equal(rep.domains.technical, reputationOf(world, "rae").domains.technical,
    "demanding nothing, it proves no domain");
});

test("every change carries domain, source, previous, delta, result, role, repetition treatment, and policy version", () => {
  const { world, clock } = reputationWorld();
  seedJob(world, "skilled", { requirements: { technical: 40 } });
  completeJob(world, clock, "rae", "skilled");

  const changes = world.history.filter((event) =>
    ["REPUTATION_CHANGED", "DOMAIN_REPUTATION_CHANGED"].includes(event.type));
  assert.ok(changes.length >= 2, "general and domain each moved");
  for (const change of changes) {
    for (const field of ["characterId", "cause", "attributionRole", "sourceEventId",
      "previous", "delta", "value", "repetitionTreatment", "reputationPolicyVersion", "domainTaxonomyVersion"]) {
      assert.notEqual(change.data[field], undefined, `${change.type} must carry ${field}`);
    }
    assert.ok(world.eventById(change.data.sourceEventId), "the source event is a real, replayable fact");
    assert.equal(change.data.value, change.data.previous + change.data.delta);
  }
});

test("a no-show costs more than a completion earns, and the floor holds", () => {
  const { world, clock, config } = reputationWorld();
  seedJob(world, "first", { requirements: { technical: 40 } });
  seedJob(world, "second", { requirements: { technical: 40 } });

  completeJob(world, clock, "rae", "first");
  const earned = reputationOf(world, "rae").general;
  assert.ok(earned > 0);

  world.acceptJob("rae", "second");
  clock.advanceGameMinutes(config.jobs.startGraceWorldHours * 60 + 1);
  world.advanceTo(clock.now());
  const after = reputationOf(world, "rae");
  assert.equal(after.general, config.reputation.minimum,
    "one no-show should wipe out more than one completion earned - and stop at the floor");
  assert.ok(after.domains.technical < earned || after.domains.technical === config.reputation.minimum,
    "the demanded domain takes the hit too");
  const drop = world.history.findLast((event) => event.type === "REPUTATION_CHANGED");
  assert.equal(drop.data.cause, "work_no_show");
  assert.ok(Math.abs(config.reputation.weights.work_no_show.general)
    > config.reputation.weights.work_completed.general,
  "the policy keeps reliability cheaper to lose than to earn");
});

test("repeating the same evidence pays in full, then half, then nothing inside the window", () => {
  const { world, clock } = reputationWorld();
  seedJob(world, "standing", { requirements: { technical: 40 }, repeatable: true });

  const deltasFor = (characterId) => world.history
    .filter((event) => event.type === "REPUTATION_CHANGED"
      && event.data.characterId === characterId && event.data.cause === "work_completed")
    .map((event) => event.data.delta);

  for (let round = 0; round < 3; round += 1) {
    completeJob(world, clock, "rae", "standing");
    clock.advanceGameMinutes(10);
    world.advanceTo(clock.now());
  }
  const deltas = deltasFor("rae");
  assert.equal(deltas.length, 2, "the third pass of the same post proves nothing new");
  assert.ok(deltas[0] > deltas[1], "and the second already proved less than the first");
  const treatments = world.history
    .filter((event) => event.type === "REPUTATION_CHANGED" && event.data.cause === "work_completed")
    .map((event) => event.data.repetitionTreatment);
  assert.deepEqual(treatments, ["full", "halved"]);
});

test("kept commitments build general reputation for both, a miss costs only the absent", () => {
  const { world, clock } = reputationWorld();
  world.defineLocation({ id: "cafe", name: "The Cafe", x: 6, y: 5 });
  world.createCharacter({
    id: "iris", name: "Iris", locationId: "square", credits: 100,
    personality: [], goal: "Meet people.", skills: {},
  });

  const invitation = world.sendInvitation("rae", "iris", {
    destinationType: "location", destinationId: "cafe", message: "Meet me at the cafe.",
  });
  world.respondToInvitation("iris", invitation.data.invitationId, "accept");
  for (const characterId of ["rae", "iris"]) world.startMove(characterId, "cafe");
  clock.advanceGameMinutes(45);
  world.advanceTo(clock.now());
  assert.ok(world.history.some((event) => event.type === "COMMITMENT_KEPT"), "the meeting happened");
  assert.ok(reputationOf(world, "rae").general > 0, "a promise kept is a verified outcome");
  assert.ok(reputationOf(world, "iris").general > 0, "for both parties");

  // Second meeting: Iris stands Rae up. Only the absent party pays.
  const raeBefore = reputationOf(world, "rae").general;
  const irisBefore = reputationOf(world, "iris").general;
  const second = world.sendInvitation("rae", "iris", {
    destinationType: "location", destinationId: "square", message: "Once more, at the square.",
  });
  world.respondToInvitation("iris", second.data.invitationId, "accept");
  world.startMove("rae", "square");
  clock.advanceGameMinutes(90);
  world.advanceTo(clock.now());
  assert.ok(world.history.some((event) => event.type === "COMMITMENT_MISSED"));
  assert.ok(reputationOf(world, "iris").general < irisBefore, "the no-show pays");
  assert.ok(reputationOf(world, "rae").general >= raeBefore, "the one who turned up does not");
});

test("a hosted night that resolved well credits its organizer, bounded per night", () => {
  const { world, clock } = reputationWorld();
  world.createCharacter({
    id: "vera", name: "Vera", locationId: "square", credits: 3_000,
    personality: [], goal: "Host.", skills: {},
  });
  const built = world.constructBuilding("vera", {
    x: 6, y: 6, width: 1, height: 1, name: "The Room", description: "A room.",
    profile: { music: 60 }, capabilities: ["host_event"],
  });
  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());
  // Three guests who genuinely love what the night delivers, so their evenings resolve well.
  for (const id of ["g1", "g2", "g3"]) {
    world.createCharacter({
      id, name: id, locationId: "square", credits: 100, personality: [], goal: "A good night.",
      preferences: { music: 100, socializing: 100, adventure: 100, relaxation: 100, creativity: 100 },
    });
  }
  const night = world.hostExperience("vera", {
    buildingId: built.data.buildingId, title: "Opening", durationGameMinutes: 120,
  });
  const venue = world.state.buildings.get(built.data.buildingId).locationId;
  for (const id of ["g1", "g2", "g3"]) world.startMove(id, venue);
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  for (const id of ["g1", "g2", "g3"]) world.joinExperience(id, night.data.id);
  clock.advanceGameMinutes(120);
  world.advanceTo(clock.now());

  const grants = world.history.filter((event) => event.type === "REPUTATION_CHANGED"
    && event.data.characterId === "vera" && event.data.cause === "experience_hosted");
  const resolutions = world.history.filter((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED"
    && event.data.rawDelta > 0);
  assert.ok(resolutions.length >= 3, "the fixture must produce well-resolved evenings");
  assert.ok(grants.length > 0, "successful organization is a verified outcome");
  assert.ok(grants.length < resolutions.length,
    "but one night cannot pay per head without limit - repetition caps it");
  assert.ok(grants.every((event) => event.data.attributionRole === "organizer"));
});

test("no action can assert reputation, and gains saturate toward the cap while losses land in full", () => {
  const { world } = reputationWorld();
  assert.throws(() => world.executeAgentAction("rae", { type: "set_reputation", value: 100 }),
    (error) => error.code === "UNKNOWN_ACTION");

  // Saturation: the same verified cause is worth less to a character already near the top.
  const anchor = world.record("DECISION_RECORDED", {
    actorCharacterId: "rae", data: { characterId: "rae", summary: "Fixture anchor." },
  });
  const low = world.applyReputationOutcome("rae", {
    cause: "work_completed", role: "worker", sourceEventId: anchor.id, repetitionKey: "fixture-low",
  })[0].data.delta;
  world.state.characters.get("rae").reputation = 90;
  const high = world.applyReputationOutcome("rae", {
    cause: "work_completed", role: "worker", sourceEventId: anchor.id, repetitionKey: "fixture-high",
  })[0].data.delta;
  assert.ok(low > high, "the first proof moves more than the ninetieth");

  // Losses do not saturate: a record is fragile at the top, that is what makes it a record.
  const loss = world.applyReputationOutcome("rae", {
    cause: "commitment_missed", role: "participant", sourceEventId: anchor.id, repetitionKey: "fixture-miss",
  })[0].data.delta;
  assert.equal(loss, world.config.reputation.weights.commitment_missed.general);
});

test("a replayed history rebuilds every reputation identically", () => {
  const { world, clock, config, store } = reputationWorld();
  seedJob(world, "skilled", { requirements: { technical: 40 } });
  completeJob(world, clock, "rae", "skilled");

  const replayed = new World({ store, config, clock });
  assert.equal(replayed.state.characters.get("rae").reputation, world.state.characters.get("rae").reputation);
  assert.deepEqual(replayed.state.characters.get("rae").domainReputation,
    world.state.characters.get("rae").domainReputation);
  assert.deepEqual(replayed.state.characters.get("rae").reputationLog,
    world.state.characters.get("rae").reputationLog);
});

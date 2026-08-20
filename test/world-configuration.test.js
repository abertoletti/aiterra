import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { activateWorldConfiguration, loadWorldConfiguration, WorldConfigurationError } from "../src/config/world-configuration.js";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";
import { settleEveryone } from "./support/pilot.js";

test("invalid external configuration is fully rejected before mutating the active world", () => {
  const world = emptyWorld();
  const invalid = validConfiguration();
  invalid.locations.push({ ...invalid.locations[0] });

  assert.throws(
    () => activateWorldConfiguration(world, invalid),
    (error) => error instanceof WorldConfigurationError && error.code === "INVALID_WORLD_CONFIGURATION",
  );
  assert.equal(world.history.length, 0);
  assert.equal(world.getPublicState().locations.length, 0);
});

test("versioned configuration activates locations, routes, jobs, and events with per-route travel", () => {
  const world = emptyWorld();
  const result = activateWorldConfiguration(world, validConfiguration());

  assert.equal(result.version, "test-world-v1");
  const state = world.getPublicState();
  assert.equal(state.worldConfigurationVersion, "test-world-v1");
  assert.equal(state.locations.length, 3);
  assert.equal(state.connections.length, 4);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.overview.totalCharacters, 2);
  assert.equal(state.overview.openJobs, 1);
  assert.equal(state.locations.find((location) => location.id === "homes").population, 1);
  assert.deepEqual(state.locations.find((location) => location.id === "homes").occupantIds, ["pilot-01"]);
  assert.equal(state.jobs[0].energyCost, 15);
  assert.equal(state.events[0].energyCost, 3);
  assert.equal(state.events[0].durationGameMinutes, 120);
  assert.equal(state.rules.realHoursPerGameDay, 4);
  assert.equal(state.rules.conversationStartEnergyCost, 1);
  assert.equal(state.rules.conversationTurnEnergyCost, 1);
  assert.equal(state.rules.maximumConversationTurns, 8);
  assert.ok(world.history.slice(1).every((event) => event.data.worldConfigurationVersion === "test-world-v1"));
  assert.equal(world.getProductMetrics().dimensions.worldConfigurationVersion, "test-world-v1");

  const observation = world.getObservation("pilot-01");
  const moves = observation.availableActions.filter((action) => action.type === "move");
  assert.deepEqual(moves.map((action) => action.destinationId), ["commons"]);
  assert.equal(moves[0].durationGameMinutes, 15);
  assert.throws(
    () => world.startMove("pilot-01", "workshop"),
    (error) => error instanceof DomainError && error.code === "UNREACHABLE_DESTINATION",
  );
  const movement = world.startMove("pilot-01", "commons");
  assert.equal(movement.data.durationGameMinutes, 15);
});

test("the checked-in example world configuration is valid", () => {
  const configuration = loadWorldConfiguration(resolve("config/world.example.json"));
  assert.equal(configuration.schemaVersion, 1);
  assert.equal(configuration.version, "internal-pilot-v1");
});

test("the checked-in ten-agent local pilot configuration is valid", () => {
  const configuration = loadWorldConfiguration(resolve("config/world.local-5.json"));
  assert.equal(configuration.characters.length, 10);
  assert.equal(configuration.jobs.length, 20);
  assert.equal(configuration.version, "local-ten-agent-pilot-v7-choose-your-square");
  assert.equal(configuration.jobs.filter((job) => job.teamSize === 2).length, 3);

  // Effort is the currency of work, and the board has to make that legible: pay tracks the
  // energy a post costs, with a premium for the skill it demands. Every post used to cost
  // the same 15 energy whatever it was, so a five-minute errand and an hour of skilled
  // labour were indistinguishable to a resident deciding how to spend its day.
  const rate = (job) => job.compensation / job.energyCost;
  for (const job of configuration.jobs) {
    assert.ok(job.energyCost >= 3 && job.energyCost <= 40, `${job.id} costs a sane amount of effort`);
    assert.ok(rate(job) >= 4 && rate(job) <= 7, `${job.id} pays a rate in the band`);
    const hardest = Math.max(0, ...Object.values(job.requirements ?? {}));
    assert.ok(job.energyCost >= Math.round(job.durationGameMinutes / 1.8),
      `${job.id} costs at least what its length implies`);
    if (hardest === 0) assert.ok(rate(job) < 4.5, `${job.id} asks nothing, so it pays the base rate`);
  }
  // A real spread, not twenty variations of one job.
  const minutes = configuration.jobs.map((job) => job.durationGameMinutes);
  assert.ok(Math.min(...minutes) <= 5 && Math.max(...minutes) >= 50, "from an errand to half a shift");
  const pay = configuration.jobs.map((job) => job.compensation);
  assert.ok(Math.max(...pay) / Math.min(...pay) >= 10, "the best post is worth many times the smallest");

  // Every square keeps an unskilled errand, so nobody is ever locked out of earning.
  for (const square of ["market", "foundry", "garden", "archive"]) {
    assert.ok(configuration.jobs.some((job) => job.locationId === square
      && Object.keys(job.requirements ?? {}).length === 0),
    `${square} keeps a notice anyone can take`);
  }

  // Four squares, one per quadrant, five notices on each board. The grid is the only source
  // of distance now, so no hand-written edge can contradict the map everyone can see.
  assert.deepEqual(configuration.locations.map((location) => location.id).sort(),
    ["archive", "foundry", "garden", "market"]);
  assert.deepEqual(configuration.connections, []);
  for (const square of configuration.locations) {
    assert.equal(configuration.jobs.filter((job) => job.locationId === square.id).length, 5,
      `${square.id} holds its own five notices`);
  }

  // Nobody is anywhere yet: choosing a square is each resident's first decision, and until
  // it is made the world shows four squares and one kind of action.
  const world = emptyWorld();
  activateWorldConfiguration(world, configuration);
  assert.ok(configuration.characters.every((character) => character.locationId === undefined),
    "the configuration must not seat anyone");
  const arrival = world.getObservation("pilot-01");
  assert.equal(arrival.arriving, true);
  assert.deepEqual(arrival.availableActions.map((action) => action.type), Array(4).fill("enter_world"));
  assert.deepEqual(arrival.squares.map((square) => square.locationId),
    ["archive", "foundry", "garden", "market"]);
  assert.ok(arrival.squares.every((square) => square.openJobs === 5 && square.payRange.lowest > 0),
    "each square advertises its board so the choice is informed");

  settleEveryone(world);
  const observation = world.getObservation("pilot-01");

  // pilot-01 chose Archive Square, so it reads Archive Square's board and no other.
  assert.equal(observation.character.locationId, "archive");
  assert.equal(observation.availableJobs.length, 5);
  assert.equal(observation.availableActions.filter((action) => action.type === "accept_job").length, 3,
    "three of the five notices on this board can be taken straight away");

  // The fifth is on the map rather than the menu, and it is blocked by exactly one thing -
  // a skill - which is the shape of a plan rather than the shape of noise. Under the old
  // contract the same resident saw twenty notices, fifteen of them unreachable, and the
  // loudest reason on them was that the work was in another part of town.
  // The two out of reach are each short of one skill and nothing else, which is the shape of
  // a plan rather than the shape of noise. One of the three she can take is a team post she
  // could not cover alone: coverage is collective, so joining is a bet on a partner.
  const reachable = observation.opportunities.filter((entry) => entry.type === "accept_job");
  assert.equal(reachable.length, 2);
  for (const entry of reachable) {
    assert.deepEqual(entry.blockedBy, ["SKILL_REQUIREMENT"]);
    assert.ok(entry.unmetRequirements.length > 0, `${entry.jobId} names what is missing`);
  }
  assert.deepEqual(observation.cannotRightNow, [],
    "work is possible here, so there is no class-wide reason to state");

  // The other three squares are a reason to travel, stated as a count and a distance.
  assert.deepEqual(observation.jobBoards.map((board) => board.locationId).sort(),
    ["archive", "foundry", "garden", "market"]);
  const elsewhere = observation.jobBoards.filter((board) => !board.here);
  assert.equal(elsewhere.length, 3);
  assert.ok(elsewhere.every((board) => board.openJobs === 5 && board.travelMinutes >= 35),
    "each holds five notices, and each is a walk away");
  assert.deepEqual(elsewhere.map((board) => board.travelMinutes), [35, 35, 70],
    "two squares adjoin this one and the third is diagonally opposite");
});

function emptyWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  let nextId = 1;
  return new World({
    store: new InMemoryEventStore(), config, clock,
    idGenerator: () => `config-${nextId++}`,
  });
}

function validConfiguration() {
  return {
    schemaVersion: 1,
    version: "test-world-v1",
    locations: [
      { id: "homes", name: "Homes", kind: "home" },
      { id: "workshop", name: "Workshop", kind: "workplace" },
      { id: "commons", name: "Commons", kind: "social_venue" },
    ],
    connections: [
      { fromLocationId: "homes", toLocationId: "commons", durationGameMinutes: 15, bidirectional: true },
      { fromLocationId: "commons", toLocationId: "workshop", durationGameMinutes: 10, bidirectional: true },
    ],
    bootstrapBudget: { id: "pilot-budget", credits: 1_000 },
    characters: [
      { id: "pilot-01", name: "Pilot 01", locationId: "homes", skills: { business: 30 } },
      { id: "pilot-02", name: "Pilot 02", locationId: "commons", skills: { business: 30 } },
    ],
    jobs: [{
      id: "shift", title: "Shift", locationId: "workshop", durationGameMinutes: 30,
      compensation: 100, requirements: { business: 20 }, fundingSource: "bootstrap",
      startsInGameMinutes: 30, offerDurationGameMinutes: 1_440,
    }],
    events: [{
      id: "meetup", title: "Meetup", locationId: "commons",
      startsInGameMinutes: 60, durationGameMinutes: 120,
    }],
  };
}

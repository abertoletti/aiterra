import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { activateWorldConfiguration, loadWorldConfiguration, WorldConfigurationError } from "../src/config/world-configuration.js";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

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

test("the checked-in seven-agent local pilot configuration is valid", () => {
  const configuration = loadWorldConfiguration(resolve("config/world.local-5.json"));
  assert.equal(configuration.characters.length, 7);
  assert.equal(configuration.jobs.length, 20);
  assert.equal(configuration.version, "local-seven-agent-pilot-v4-dynamic-action");
  assert.equal(configuration.jobs.filter((job) => job.teamSize === 2).length, 2);
  assert.ok(configuration.jobs.every((job) => job.durationGameMinutes <= 35));

  const world = emptyWorld();
  activateWorldConfiguration(world, configuration);
  const observation = world.getObservation("pilot-01");
  assert.equal(observation.availableJobs.length, 20);
  assert.equal(observation.availableActions.filter((action) => action.type === "accept_job").length, 20);
  assert.ok(observation.availableActions.some((action) =>
    action.type === "accept_job" && action.feasibility.blockingCodes.includes("WRONG_LOCATION")));
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

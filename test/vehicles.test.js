import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

// Personal mobility policy v1. These tests pin the rules - one slot, city-sold only, time
// compressed never below the floor, wear charged only for a ride that shortened something,
// money retired - and none of the catalog numbers.

function vehicleWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  let nextId = 1;
  const world = new World({
    store: new InMemoryEventStore(), config, clock, idGenerator: () => `vehicle-${nextId++}`,
  });
  // Far corners of the grid, so a ride has real distance to compress.
  world.defineLocation({ id: "west", name: "West Square", x: 2, y: 2 });
  world.defineLocation({ id: "east", name: "East Square", x: 16, y: 2 });
  world.defineLocation({ id: "next-door", name: "Next Door", x: 3, y: 2 });
  world.createCharacter({
    id: "ada", name: "Ada", locationId: "west", credits: 5_000,
    personality: [], goal: "Get around.", skills: {},
  });
  return { world, clock, config };
}

const bicycle = (config) => config.vehicles.catalog.find((vehicle) => vehicle.id === "bicycle");

test("the city's counter discloses every term, and a purchase is one slot with no refund", () => {
  const { world, config } = vehicleWorld();
  const counter = world.getObservation("ada").availableActions
    .find((action) => action.type === "buy_vehicle");
  assert.ok(counter, "the catalog is offered");
  assert.equal(counter.replacesOwnedWithoutRefund, true, "the refundless slot is disclosed before buying");
  for (const vehicle of counter.catalog) {
    for (const field of ["vehicleId", "price", "travelTimeFactor", "usageCost"]) {
      assert.notEqual(vehicle[field], undefined, `the counter must disclose ${field}`);
    }
  }

  const before = world.getObservation("ada").character.credits;
  world.buyVehicle("ada", "bicycle");
  const owner = world.getObservation("ada").character;
  assert.equal(owner.vehicle.id, "bicycle");
  assert.equal(owner.credits, before - bicycle(config).price);
  assert.throws(() => world.buyVehicle("ada", "bicycle"),
    (error) => error instanceof DomainError && error.code === "VEHICLE_ALREADY_OWNED");
  assert.throws(() => world.buyVehicle("ada", "hoverboard"),
    (error) => error instanceof DomainError && error.code === "UNKNOWN_VEHICLE",
    "only the city's versioned catalog sells mobility");

  // Upgrading replaces the slot: the bicycle is gone, refundless, as disclosed.
  world.buyVehicle("ada", "car");
  const upgraded = world.getObservation("ada").character;
  assert.equal(upgraded.vehicle.id, "car");
  assert.equal(upgraded.wallet.opening + upgraded.wallet.earned - upgraded.wallet.spent, upgraded.credits,
    "the wallet identity survives both purchases");
});

test("a ride compresses a long trip, never below the floor, and the wear is charged with it", () => {
  const { world, config } = vehicleWorld();
  const walk = world.getObservation("ada").availableActions
    .find((action) => action.type === "move" && action.destinationId === "east");
  world.buyVehicle("ada", "bicycle");
  const ride = world.getObservation("ada").availableActions
    .find((action) => action.type === "move" && action.destinationId === "east");

  assert.ok(ride.durationGameMinutes < walk.durationGameMinutes, "the ride shortens the trip");
  assert.equal(ride.durationGameMinutes,
    Math.max(config.movement.minimumDurationGameMinutes,
      Math.round(walk.durationGameMinutes * bicycle(config).travelTimeFactor)),
    "by exactly the disclosed factor, floored");
  assert.equal(ride.rides, "bicycle");
  assert.equal(ride.vehicleUsageCost, bicycle(config).usageCost, "the wear is stated on the affordance");
  assert.equal(ride.walkMinutes, walk.durationGameMinutes, "beside what walking would cost");

  const before = world.getObservation("ada").character.credits;
  const movement = world.startMove("ada", "east");
  assert.equal(movement.data.durationGameMinutes, ride.durationGameMinutes);
  assert.equal(world.getObservation("ada").character.credits, before - bicycle(config).usageCost,
    "the disclosed wear is charged when the ride happens");
});

test("a hop the vehicle cannot shorten is a free walk: no fee for a ride that saved nothing", () => {
  const { world, config } = vehicleWorld();
  world.buyVehicle("ada", "car");
  const hop = world.getObservation("ada").availableActions
    .find((action) => action.type === "move" && action.destinationId === "next-door");
  assert.equal(hop.durationGameMinutes, config.movement.minimumDurationGameMinutes,
    "one cell is already at the floor");
  assert.equal(hop.rides, undefined, "so nothing rides");
  assert.equal(hop.vehicleUsageCost, undefined);

  const before = world.getObservation("ada").character.credits;
  world.startMove("ada", "next-door");
  assert.equal(world.getObservation("ada").character.credits, before,
    "and no wear is charged for a trip the machine did not shorten");
});

test("an owner who cannot pay the wear walks, and is told why", () => {
  const { world, config } = vehicleWorld();
  world.createCharacter({
    id: "bo", name: "Bo", locationId: "west",
    credits: config.vehicles.catalog.find((vehicle) => vehicle.id === "car").price,
    personality: [], goal: "Drive.", skills: {},
  });
  world.buyVehicle("bo", "car");
  assert.equal(world.getObservation("bo").character.credits, 0, "the purchase took everything");

  const broke = world.getObservation("bo").availableActions
    .find((action) => action.type === "move" && action.destinationId === "east");
  assert.equal(broke.rides, undefined, "no credits, no ride");
  assert.equal(broke.vehicleBlockedBy, "INSUFFICIENT_CREDITS", "stated, not silent");
  const movement = world.startMove("bo", "east");
  assert.equal(movement.data.durationGameMinutes, broke.durationGameMinutes,
    "the command and the affordance agree: the trip is a walk");
});

test("purchase and wear leave the world as retired credits, and the books still balance", () => {
  const { world, config } = vehicleWorld();
  world.bootstrapEconomy({ budgetId: "budget", credits: 10_000 });
  const accounts = () => {
    const { overview } = world.getPublicState();
    return {
      supply: overview.moneySupply + overview.systemBudgetBalance,
      held: overview.characterCredits + overview.buildingCredits
        + overview.reservedCredits + overview.systemBudgetBalance,
    };
  };
  const retiredBefore = world.getPublicState().overview.creditsRetired;
  world.buyVehicle("ada", "bicycle");
  world.startMove("ada", "east");
  const retired = world.getPublicState().overview.creditsRetired - retiredBefore;
  assert.equal(retired, bicycle(config).price + bicycle(config).usageCost,
    "the machine and its wear are money spent out of existence");
  const { supply, held } = accounts();
  assert.equal(held, supply, "no credit went missing or appeared");
});

test("a replayed history rebuilds ownership and the fee trail identically", () => {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const store = new InMemoryEventStore();
  let nextId = 1;
  const world = new World({ store, config, clock, idGenerator: () => `vehicle-${nextId++}` });
  world.defineLocation({ id: "west", name: "West", x: 2, y: 2 });
  world.defineLocation({ id: "east", name: "East", x: 16, y: 2 });
  world.createCharacter({ id: "ada", name: "Ada", locationId: "west", credits: 1_000, personality: [], goal: "Ride.", skills: {} });
  world.buyVehicle("ada", "bicycle");
  world.startMove("ada", "east");

  const replayed = new World({ store, config, clock });
  assert.deepEqual(replayed.state.characters.get("ada").vehicle, world.state.characters.get("ada").vehicle);
  assert.equal(replayed.state.characters.get("ada").credits, world.state.characters.get("ada").credits);
  assert.equal(replayed.state.creditsRetired, world.state.creditsRetired);
});

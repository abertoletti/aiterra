import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

// Personal mobility policy v1. These tests pin the rules - a garage of at most one of
// each, city-sold only, the mode chosen per trip by the rider, time compressed never
// below the floor, wear charged whenever a ride is chosen, money retired - and none of
// the catalog numbers.

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

const catalogEntry = (config, id) => config.vehicles.catalog.find((vehicle) => vehicle.id === id);

test("the city's counter discloses every term, and the garage holds one of each at most", () => {
  const { world, config } = vehicleWorld();
  const counter = world.getObservation("ada").availableActions
    .find((action) => action.type === "buy_vehicle");
  assert.ok(counter, "the catalog is offered");
  for (const vehicle of counter.catalog) {
    for (const field of ["vehicleId", "price", "travelTimeFactor", "usageCost"]) {
      assert.notEqual(vehicle[field], undefined, `the counter must disclose ${field}`);
    }
  }

  const before = world.getObservation("ada").character.credits;
  world.buyVehicle("ada", "bicycle");
  world.buyVehicle("ada", "car");
  const owner = world.getObservation("ada").character;
  assert.deepEqual(owner.garage.map((vehicle) => vehicle.id).sort(), ["bicycle", "car"],
    "both vehicles park side by side");
  assert.equal(owner.credits,
    before - catalogEntry(config, "bicycle").price - catalogEntry(config, "car").price);
  assert.equal(owner.wallet.opening + owner.wallet.earned - owner.wallet.spent, owner.credits,
    "the wallet identity survives both purchases");

  assert.throws(() => world.buyVehicle("ada", "bicycle"),
    (error) => error instanceof DomainError && error.code === "VEHICLE_ALREADY_OWNED");
  assert.throws(() => world.buyVehicle("ada", "hoverboard"),
    (error) => error instanceof DomainError && error.code === "UNKNOWN_VEHICLE",
    "only the city's versioned catalog sells mobility");
  assert.equal(world.getObservation("ada").availableActions
    .find((action) => action.type === "buy_vehicle"), undefined,
  "a full garage closes the counter rather than offering nothing");
});

test("every way to travel is priced on the move, and the rider's explicit choice decides", () => {
  const { world, config } = vehicleWorld();
  world.buyVehicle("ada", "bicycle");
  world.buyVehicle("ada", "car");

  const move = world.getObservation("ada").availableActions
    .find((action) => action.type === "move" && action.destinationId === "east");
  assert.equal(move.travelOptions.length, 3, "walk plus both garage vehicles");
  const byId = Object.fromEntries(move.travelOptions.map((option) => [option.vehicleId ?? "walk", option]));
  assert.equal(byId.walk.usageCost, 0, "walking is always offered and always free");
  assert.equal(move.durationGameMinutes, byId.walk.minutes, "the default is on foot");
  for (const id of ["bicycle", "car"]) {
    const entry = catalogEntry(config, id);
    assert.equal(byId[id].minutes,
      Math.max(config.movement.minimumDurationGameMinutes, Math.round(byId.walk.minutes * entry.travelTimeFactor)),
      `${id} minutes follow the disclosed factor, floored`);
    assert.equal(byId[id].usageCost, entry.usageCost, `${id} states its wear beside its minutes`);
  }

  // The choice is a parameter of the move, and each choice charges exactly what it said.
  const credits = () => world.getObservation("ada").character.credits;
  const before = credits();
  const ride = world.startMove("ada", "east", { vehicleId: "car" });
  assert.equal(ride.data.durationGameMinutes, byId.car.minutes);
  assert.equal(ride.data.vehicleId, "car");
  assert.equal(credits(), before - catalogEntry(config, "car").usageCost,
    "the chosen ride charges its disclosed wear");
});

test("omitting the vehicle walks, free, even with a full garage", () => {
  const { world } = vehicleWorld();
  world.buyVehicle("ada", "car");
  const before = world.getObservation("ada").character.credits;
  const walkOption = world.getObservation("ada").availableActions
    .find((action) => action.type === "move" && action.destinationId === "east").travelOptions[0];
  const movement = world.startMove("ada", "east");
  assert.equal(movement.data.durationGameMinutes, walkOption.minutes, "no vehicleId means on foot");
  assert.equal(movement.data.vehicleId, undefined);
  assert.equal(world.getObservation("ada").character.credits, before, "and no wear is charged");
});

test("a ride must be owned and its wear payable, and both facts were stated first", () => {
  const { world, config } = vehicleWorld();
  assert.throws(() => world.startMove("ada", "east", { vehicleId: "car" }),
    (error) => error instanceof DomainError && error.code === "VEHICLE_NOT_OWNED",
    "the garage is the server's record, not the rider's claim");

  world.createCharacter({
    id: "bo", name: "Bo", locationId: "west",
    credits: catalogEntry(config, "car").price,
    personality: [], goal: "Drive.", skills: {},
  });
  world.buyVehicle("bo", "car");
  const option = world.getObservation("bo").availableActions
    .find((action) => action.type === "move" && action.destinationId === "east")
    .travelOptions.find((entry) => entry.vehicleId === "car");
  assert.equal(option.affordable, false, "the option says the wear is not payable right now");
  assert.throws(() => world.startMove("bo", "east", { vehicleId: "car" }),
    (error) => error instanceof DomainError && error.code === "INSUFFICIENT_CREDITS");
  assert.equal(world.startMove("bo", "east").data.vehicleId, undefined, "walking remains open");
});

test("the boards state on-foot distances, unchanged by what the garage holds", () => {
  // "Fastest affordable" was tried and dropped: it hid the wear inside the number, it
  // disagreed with what a vehicle-less move actually does, and it moved whenever a wallet
  // did. The board states the one complete, default-matching fact; what a garage does to
  // it is the rider's own arithmetic, and the exact options sit on the move affordance.
  const { world } = vehicleWorld();
  const onFoot = world.getObservation("ada").jobBoards
    .find((board) => board.locationId === "east").travelMinutes;
  world.buyVehicle("ada", "car");
  const withCar = world.getObservation("ada").jobBoards
    .find((board) => board.locationId === "east").travelMinutes;
  assert.equal(withCar, onFoot, "the board's distance embeds no vehicle and no judgement");
  assert.ok(world.getObservation("ada").availableActions
    .find((action) => action.type === "move" && action.destinationId === "east")
    .travelOptions.some((option) => option.vehicleId === "car"),
  "while the move itself prices every way to go");
});

test("purchases and wear leave the world as retired credits, and the books still balance", () => {
  const { world, config } = vehicleWorld();
  world.bootstrapEconomy({ budgetId: "budget", credits: 10_000 });
  const retiredBefore = world.getPublicState().overview.creditsRetired;
  world.buyVehicle("ada", "bicycle");
  world.startMove("ada", "east", { vehicleId: "bicycle" });
  const retired = world.getPublicState().overview.creditsRetired - retiredBefore;
  assert.equal(retired, catalogEntry(config, "bicycle").price + catalogEntry(config, "bicycle").usageCost,
    "the machine and its wear are money spent out of existence");
  const { overview } = world.getPublicState();
  assert.equal(
    overview.characterCredits + overview.reservedCredits + overview.systemBudgetBalance,
    overview.moneySupply + overview.systemBudgetBalance,
    "no credit went missing or appeared");
});

test("a replayed history rebuilds the garage and the fee trail identically", () => {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const store = new InMemoryEventStore();
  let nextId = 1;
  const world = new World({ store, config, clock, idGenerator: () => `vehicle-${nextId++}` });
  world.defineLocation({ id: "west", name: "West", x: 2, y: 2 });
  world.defineLocation({ id: "east", name: "East", x: 16, y: 2 });
  world.createCharacter({ id: "ada", name: "Ada", locationId: "west", credits: 3_000, personality: [], goal: "Ride.", skills: {} });
  world.buyVehicle("ada", "bicycle");
  world.buyVehicle("ada", "car");
  world.startMove("ada", "east", { vehicleId: "bicycle" });

  const replayed = new World({ store, config, clock });
  assert.deepEqual(replayed.state.characters.get("ada").garage, world.state.characters.get("ada").garage);
  assert.equal(replayed.state.characters.get("ada").credits, world.state.characters.get("ada").credits);
  assert.equal(replayed.state.creditsRetired, world.state.creditsRetired);
});

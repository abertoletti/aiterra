import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { validateAction } from "../src/agents/decision-planner.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

// A city world: two residents with money, and two seeded locations that sit on the grid
// like everything else, so distance is the only travel rule there is.
function cityWorld({ credits = 4000, upkeepIntervalWorldMinutes = null } = {}) {
  const clock = new ManualClock("2042-05-01T18:00:00.000Z");
  const overrides = upkeepIntervalWorldMinutes ? { city: { upkeepIntervalWorldMinutes } } : {};
  const world = new World({
    store: new InMemoryEventStore(), config: makeConfig(overrides), clock, random: () => 0.5,
  });
  world.defineLocation({ id: "commons", name: "Town Commons", x: 10, y: 10 });
  world.defineLocation({ id: "homes", name: "Residential Court", x: 10, y: 7 });
  world.bootstrapEconomy();
  world.createCharacter({
    id: "luca", name: "Luca", locationId: "commons", credits,
    personality: ["Ambitious"], goal: "Own the nightlife.",
    preferences: {
      music: 90, socializing: 80, learning: 20, competition: 60, spirituality: 10,
      luxury: 70, adventure: 80, relaxation: 30, creativity: 60, nature: 0,
    },
  });
  world.createCharacter({
    id: "anna", name: "Anna", locationId: "homes", credits: 300,
    personality: ["Curious"], goal: "Hear something new.",
    preferences: {
      music: 100, socializing: 90, learning: 60, competition: 0, spirituality: 30,
      luxury: 40, adventure: 50, relaxation: 50, creativity: 80, nature: 0,
    },
  });
  return { world, clock };
}

function buildTheHole(world, overrides = {}) {
  return world.constructBuilding("luca", {
    x: 12, y: 10, width: 1, height: 1,
    name: overrides.name ?? "The Hole",
    description: overrides.description
      ?? "An underground techno club for people who hate mainstream nightlife.",
    profile: overrides.profile ?? { music: 90, socializing: 80, luxury: 20 },
    capabilities: overrides.capabilities ?? ["host_event", "sell_access", "create_job"],
  });
}

test("building claims the ground, and a claimed cell cannot be built on twice", () => {
  const { world, clock } = cityWorld();

  const started = buildTheHole(world);
  assert.deepEqual(started.data.plotIds, ["plot-12-10"], "the footprint's cells are claimed by the build");
  assert.equal(world.state.plots.get("plot-12-10").buildingId, started.data.buildingId);
  assert.equal(world.plotView(12, 10).available, false);

  // There is no purchase step to fail at: either you can build or you cannot.
  assert.throws(() => world.constructBuilding("anna", {
    x: 12, y: 10, name: "On Top", description: "x",
    profile: { music: 40 }, capabilities: ["host_event"],
  }), (error) => error instanceof DomainError && error.code === "PLOT_OCCUPIED");

  assert.throws(() => world.constructBuilding("luca", {
    x: 0, y: 10, name: "Off Grid", description: "x",
    profile: { music: 40 }, capabilities: ["host_event"],
  }), (error) => error instanceof DomainError && error.code === "OFF_GRID");

  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  assert.equal(world.state.buildings.get(started.data.buildingId).status, "ACTIVE");
});

test("construction is priced convexly, so promising everything is unaffordable", () => {
  const { world } = cityWorld();

  // One focused dimension against the same total spread thin: same ambition, same price.
  const focused = world.buildingQuote({ music: 100 }, 1, 1);
  const spread = world.buildingQuote(
    Object.fromEntries("music socializing learning competition spirituality luxury adventure relaxation creativity nature"
      .split(" ").map((d) => [d, 10])), 1, 1);
  assert.equal(focused.constructionCost, spread.constructionCost,
    "cost is neutral about distribution; affinity is what rewards focus");
  assert.equal(focused.constructionCost, 500);
  assert.equal(focused.capacity, 10);

  // Breadth is ruinous, and that is the whole mechanism.
  const everything = world.buildingQuote(
    Object.fromEntries("music socializing learning competition spirituality luxury adventure relaxation creativity nature"
      .split(" ").map((d) => [d, 100])), 2, 2);
  assert.equal(everything.constructionCost, 120_800);
  assert.equal(everything.capacity, 40);

  assert.throws(() => {
    world.constructBuilding("luca", {
      x: 5, y: 5, name: "Everything At Once",
      profile: Object.fromEntries("music socializing learning competition spirituality luxury adventure relaxation creativity nature"
        .split(" ").map((d) => [d, 100])),
      capabilities: ["host_event"],
    });
  }, (error) => error instanceof DomainError && error.code === "INSUFFICIENT_CREDITS");
});

test("a finished building is a venue: the city gets in when something is on", () => {
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  assert.equal(started.data.status, "UNDER_CONSTRUCTION");
  assert.equal(started.data.capacity, 10);

  // It is not a place yet, so nobody can go there.
  assert.throws(() => world.startMove("anna", started.data.buildingId),
    (error) => error instanceof DomainError && error.code === "LOCATION_NOT_FOUND");

  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const building = world.state.buildings.get(started.data.buildingId);
  assert.equal(building.status, "ACTIVE");
  assert.equal(building.locationId, started.data.buildingId);

  // Built, but nothing programmed: a private venue is not a public room, and walking in
  // for free was how residents took the co-presence without ever buying a ticket.
  assert.throws(() => world.startMove("anna", building.locationId),
    (error) => error instanceof DomainError && error.code === "BUILDING_CLOSED");

  // Shut is not hidden. It leaves the menu of things that can be done now and joins the
  // map of things that exist, with the reason, so a resident can plan around a closed door.
  const anna = world.getObservation("anna");
  assert.ok(!anna.availableActions.some((action) => action.destinationId === building.locationId),
    "a shut venue is not something you can walk into right now");
  const shutOffer = anna.opportunities
    .find((entry) => entry.type === "move" && entry.destinationId === building.locationId);
  assert.ok(shutOffer, "but it is still a place on the map");
  assert.deepEqual(shutOffer.blockedBy, ["BUILDING_CLOSED"]);

  // The proprietor can always get in: someone has to open up.
  assert.ok(world.startMove("luca", building.locationId));

  world.hostExperience("luca", {
    buildingId: building.buildingId, title: "Friday Night", description: "Doors at ten.",
    profile: { music: 90, socializing: 70 }, durationGameMinutes: 120, accessPrice: 30,
  });

  // Anna is at homes (10,7), the club is at (12,10): five cells, five minutes each.
  const move = world.startMove("anna", building.locationId);
  assert.equal(move.data.durationGameMinutes, 25,
    "the grid decides the trip, with no configured edge to the new place");
  clock.advanceGameMinutes(25);
  world.advanceTo(clock.now());
  assert.equal(world.getObservation("anna").character.locationId, building.locationId);
});

test("the doors open early enough to walk there before the start", () => {
  // A venue that only admitted people once the event had begun would guarantee everyone
  // arrived late, since the trip itself takes game minutes.
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;

  const lead = makeConfig().city.doorsOpenBeforeWorldMinutes;
  world.hostExperience("luca", {
    buildingId, title: "Later Tonight", profile: { music: 60 },
    durationGameMinutes: 60, accessPrice: 10, startsInGameMinutes: lead + 10,
  });

  const stillShut = world.getObservation("anna").opportunities
    .find((entry) => entry.type === "move" && entry.destinationId === buildingId);
  assert.ok(stillShut, "too early: the doors have not opened, so it is on the map not the menu");
  assert.ok(stillShut.opensAt, "but the observation says when they will");
  assert.equal(stillShut.nextEventTitle, "Later Tonight");

  clock.advanceGameMinutes(11);
  const nowOpen = world.getObservation("anna").availableActions
    .find((action) => action.type === "move" && action.destinationId === buildingId);
  assert.ok(nowOpen, "the doors open a lead time before the start, so the trip can begin");
  assert.ok(world.startMove("anna", buildingId));
});

test("the building's profile is the ceiling on what it can host", () => {
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;

  assert.throws(() => world.hostExperience("luca", {
    buildingId, title: "Symphony", profile: { music: 100 },
    durationGameMinutes: 60,
  }), (error) => error instanceof DomainError && error.code === "PROFILE_EXCEEDS_BUILDING",
  "a club with music 90 cannot host the city's great music night");

  assert.throws(() => world.hostExperience("luca", {
    buildingId, title: "Retreat", profile: { spirituality: 40 },
    durationGameMinutes: 60,
  }), (error) => error instanceof DomainError && error.code === "PROFILE_EXCEEDS_BUILDING",
  "and cannot deliver a dimension it never paid for");

  const hosted = world.hostExperience("luca", {
    buildingId, title: "Friday Night", description: "Doors at ten, no guest list.",
    profile: { music: 90, socializing: 70 }, durationGameMinutes: 120, accessPrice: 30,
  });
  assert.equal(hosted.data.profile.music, 90);
  assert.equal(hosted.data.accessPrice, 30);
  assert.equal(hosted.data.capacity, 10, "capacity defaults to what the footprint bought");
  assert.equal(hosted.data.buildingId, buildingId);

  assert.throws(() => world.hostExperience("anna", {
    buildingId, title: "Not Hers", profile: { music: 10 }, durationGameMinutes: 60,
  }), (error) => error instanceof DomainError && error.code === "NOT_PROPRIETOR");
});

test("capabilities are enforced, not narrated", () => {
  const { world, clock } = cityWorld();
  world.constructBuilding("luca", {
    x: 12, y: 10, name: "The Quiet Room", profile: { relaxation: 60 },
    capabilities: ["create_job"],
  });
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = [...world.state.buildings.keys()][0];

  assert.throws(() => world.hostExperience("luca", {
    buildingId, title: "A Night", profile: { relaxation: 40 }, durationGameMinutes: 60,
  }), (error) => error instanceof DomainError && error.code === "CAPABILITY_MISSING");

  assert.throws(() => world.constructBuilding("luca", {
    x: 13, y: 10, name: "No Capability", profile: { music: 10 }, capabilities: [],
  }), (error) => error instanceof DomainError && error.code === "NO_CAPABILITY");
  assert.throws(() => world.constructBuilding("luca", {
    x: 13, y: 10, name: "Invented", profile: { music: 10 }, capabilities: ["run_casino"],
  }), (error) => error instanceof DomainError && error.code === "UNKNOWN_CAPABILITY",
  "an invented capability is rejected, never quietly ignored");

});

test("a resident-built night earns its proprietor the admission", () => {
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;
  const hosted = world.hostExperience("luca", {
    buildingId, title: "Friday Night", profile: { music: 90, socializing: 70 },
    durationGameMinutes: 120, accessPrice: 30,
  });

  // Anna finds it without an invitation, from the other side of town.
  const listed = world.inspectContext("anna", { resource: "experiences", limit: 50 })
    .items.find((item) => item.id === hosted.data.id);
  assert.ok(listed, "a resident-created night is discoverable like any other");
  assert.equal(listed.accessPrice, 30);
  assert.ok(listed.affinity > 70, "and Anna, who cares about music, can see that it suits her");

  world.startMove("anna", buildingId);
  clock.advanceGameMinutes(25);
  world.advanceTo(clock.now());

  const annaBefore = world.getObservation("anna").character.credits;
  const lucaBefore = world.getObservation("luca").character.credits;
  world.joinExperience("anna", hosted.data.id);
  assert.equal(world.getObservation("anna").character.credits, annaBefore - 30);
  assert.equal(world.getObservation("luca").character.credits, lucaBefore + 30,
    "admission is paid straight into the proprietor's wallet");
  assert.equal(world.state.buildings.get(buildingId).revenue, 30,
    "and the venue keeps a revenue ledger of what came through the door");
  assert.equal(world.state.buildings.get(buildingId).balance, undefined,
    "the building itself holds no separate balance");

  clock.advanceGameMinutes(100);
  world.leaveExperience("anna", hosted.data.id);
  const resolved = world.history.filter((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED");
  assert.equal(resolved.length, 1, "the engine resolves a resident-built night like any other");
  assert.ok(resolved[0].data.factors.affinity > 0, "and it was worth something to her");
});

test("upkeep is charged to the proprietor's wallet, and failure is explicit", () => {
  const { world, clock } = cityWorld({ upkeepIntervalWorldMinutes: 60 });
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;
  const perInterval = world.state.buildings.get(buildingId).upkeepPerInterval;
  assert.ok(perInterval >= 1);

  // A venue keeps no purse of its own: upkeep comes straight out of the owner's wallet.
  const before = world.getObservation("luca").character.credits;
  clock.advanceGameMinutes(60);
  world.advanceTo(clock.now());
  const paid = world.history.filter((event) => event.type === "BUILDING_UPKEEP_PAID");
  assert.equal(paid.length, 1, "charged exactly once per due interval");
  assert.equal(world.getObservation("luca").character.credits, before - perInterval,
    "the charge comes straight out of the proprietor's wallet");
  assert.equal(world.state.buildings.get(buildingId).upkeepPaid, perInterval,
    "and the venue's upkeep ledger records what it cost to keep standing");

  // A solvent proprietor keeps the building however many intervals pass: delinquency should
  // mean insolvent, not inattentive, and a resident holding thousands should not lose a
  // building over an unpaid two.
  clock.advanceGameMinutes(60 * 40);
  world.advanceTo(clock.now());
  assert.equal(world.state.buildings.get(buildingId).status, "ACTIVE",
    "a solvent proprietor keeps the building");
  const paidFromPocket = world.history.filter((event) => event.type === "BUILDING_UPKEEP_PAID"
    && event.data.fromProprietor > 0);
  assert.ok(paidFromPocket.length > 0, "and every charge comes out of their credits");
});

test("a building whose proprietor is also broke fails explicitly", () => {
  // Just enough to build, and nothing left over.
  const { world, clock } = cityWorld({ credits: 1_290, upkeepIntervalWorldMinutes: 60 });
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;
  assert.ok(world.getObservation("luca").character.credits < 20, "the proprietor is spent");

  clock.advanceGameMinutes(60 * 40);
  world.advanceTo(clock.now());
  const failed = world.history.filter((event) => event.type === "BUILDING_UPKEEP_FAILED");
  assert.ok(failed.length > 0, "an unfundable building fails explicitly rather than going into hidden debt");
  assert.equal(world.state.buildings.get(buildingId).status, "DELINQUENT");
  assert.ok(failed[0].data.shortfall > 0, "with the shortfall recorded");
});

test("an agent can actually reach the authoring actions through the runner", () => {
  const { world, clock } = cityWorld();
  const offered = (id) => world.getObservation(id, { contextMode: "progressive" }).availableActions;

  // The build affordance is declared once rather than enumerating 400 cells by four
  // footprints, but it names what an agent cannot guess: the cells already gone.
  const buildOffer = offered("luca").find((action) => action.type === "construct_building");
  assert.ok(buildOffer, "building needs no prerequisite, so it is always offered");
  assert.equal(buildOffer.gridWidth, 20);
  assert.equal(buildOffer.costFormula.structuralCostPerCell, 200);
  assert.equal(buildOffer.cheapestUsefulBuilding, 500);
  assert.ok(buildOffer.takenCells.some((cell) => cell.x === 10 && cell.y === 10),
    "the commons stands on 10,10 and the agent is told so");

  const proposal = validateAction({
    type: "construct_building", x: 12, y: 10, width: 1, height: 1,
    name: "The Hole", description: "Underground techno for people who hate the mainstream.",
    profile: { music: 90, socializing: 80, luxury: 20 },
    capabilities: ["host_event", "sell_access"],
  }, { availableActions: offered("luca") });
  assert.equal(proposal.name, "The Hole");
  assert.deepEqual(proposal.capabilities, ["host_event", "sell_access"]);

  assert.throws(() => validateAction({
    type: "construct_building", x: 12, y: 10, name: "Casino", description: "x",
    profile: { music: 10 }, capabilities: ["run_casino"],
  }, { availableActions: offered("luca") }), /not offered/);
  assert.throws(() => validateAction({
    type: "construct_building", x: 12, y: 10, name: "Nothing", description: "x",
    profile: { nightlife: 90 }, capabilities: ["host_event"],
  }, { availableActions: offered("luca") }), /not a profile dimension/);

  // And the validated proposal is accepted by the server unchanged.
  const applied = world.executeAgentAction("luca", proposal, "build-1");
  assert.ok(applied.buildingId, "the server accepts the validated proposal unchanged");
  assert.equal(world.executeAgentAction("luca", proposal, "build-1").buildingId, applied.buildingId,
    "and a retry returns the original result rather than building twice");
  assert.equal(world.state.buildings.size, 1);

  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const hostOffer = offered("luca").find((action) => action.type === "host_experience");
  assert.ok(hostOffer, "an active building offers the night it can host");
  assert.equal(hostOffer.profileCeiling.music, 90);
  assert.equal(hostOffer.canChargeAdmission, true);
  assert.throws(() => validateAction({
    type: "host_experience", buildingId: hostOffer.buildingId, title: "Too Loud",
    description: "x", profile: { music: 100 }, durationGameMinutes: 60,
  }, { availableActions: offered("luca") }), /above 90/,
  "the runner refuses to send a night the building cannot deliver");
});

test("the venue's revenue and upkeep ledger, and the takings in the owner's wallet, survive a replay", () => {
  const { world, clock } = cityWorld({ upkeepIntervalWorldMinutes: 60 });
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;

  const hosted = world.hostExperience("luca", {
    buildingId, title: "Friday Night", profile: { music: 90, socializing: 70 },
    durationGameMinutes: 120, accessPrice: 30,
  });
  world.startMove("anna", buildingId);
  clock.advanceGameMinutes(25);
  world.advanceTo(clock.now());
  world.joinExperience("anna", hosted.data.id);
  clock.advanceGameMinutes(60);
  world.advanceTo(clock.now());

  const replayed = new World({
    store: new InMemoryEventStore(world.history), config: makeConfig(),
    clock: new ManualClock(clock.now()), random: () => 0.5,
  });
  const original = world.state.buildings.get(buildingId);
  const rebuilt = replayed.state.buildings.get(buildingId);
  assert.equal(rebuilt.revenue, original.revenue, "the admission ledger replays identically");
  assert.ok(original.revenue > 0, "and there was admission to record");
  assert.equal(rebuilt.upkeepPaid, original.upkeepPaid, "so does the upkeep ledger");
  assert.equal(rebuilt.status, original.status);
  assert.equal(rebuilt.locationId, original.locationId);
  assert.deepEqual(rebuilt.profile, original.profile);
  assert.equal(replayed.state.characters.get("luca").credits, world.state.characters.get("luca").credits,
    "and the proprietor's wallet - where the takings live now - rebuilds exactly");
  assert.equal(replayed.state.plots.get("plot-12-10").buildingId, buildingId);
});

test("the city is visible from anywhere, so a night elsewhere can be chosen", () => {
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  world.hostExperience("luca", {
    buildingId: started.data.buildingId, title: "Friday Night",
    description: "Doors at ten.", profile: { music: 90, socializing: 70 },
    durationGameMinutes: 120, accessPrice: 30,
  });

  // Anna is at homes and has never heard of the place. Three runs showed that no agent
  // ever requests a catalog, so a gathering it must ask about is a gathering nobody
  // attends. The observation carries the city itself.
  const tonight = world.getObservation("anna", { contextMode: "progressive" }).cityTonight;
  assert.equal(tonight.length, 1);
  assert.equal(tonight[0].title, "Friday Night");
  assert.equal(tonight[0].accessPrice, 30);
  assert.equal(tonight[0].here, false);
  assert.equal(tonight[0].travelMinutes, 25, "and says what getting there costs");
  assert.ok(tonight[0].affinity > 70, "and what it is worth to this particular resident");
  assert.deepEqual(tonight[0].tags, ["music", "socializing"]);
});

test("hosting can omit the profile and deliver what the place delivers", () => {
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());

  const hosted = world.hostExperience("luca", {
    buildingId: started.data.buildingId, title: "Just Another Friday",
    description: "The usual.", durationGameMinutes: 90, accessPrice: 20,
  });
  assert.deepEqual(hosted.data.profile, world.state.buildings.get(started.data.buildingId).profile,
    "composing a vector is the heaviest part of hosting, so omitting it is allowed");
});

test("a proprietor can see the upkeep coming and whether the place is idle", () => {
  const { world, clock } = cityWorld({ upkeepIntervalWorldMinutes: 60 });
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());

  const offerFor = () => world.getObservation("luca").availableActions
    .find((action) => action.type === "host_experience");
  const idle = offerFor();
  assert.equal(idle.liveExperienceCount, 0, "an idle building is the thing upkeep punishes");
  assert.ok(idle.nextUpkeepAt, "so the charge has to be visible before it lands");
  assert.equal(idle.upkeepPerInterval >= 1, true);

  world.hostExperience("luca", {
    buildingId: started.data.buildingId, title: "Tonight",
    description: "On.", durationGameMinutes: 120,
  });
  assert.equal(offerFor().liveExperienceCount, 1);
});

test("nobody can buy the ground the town square stands on", () => {
  const { world } = cityWorld();

  // The commons sits at 10,10. Seeded places occupy their cells as surely as buildings
  // do, and the first live run had a resident build a lounge on top of the town square.
  assert.throws(() => world.constructBuilding("luca", {
    x: 10, y: 10, name: "On The Square", description: "x",
    profile: { music: 40 }, capabilities: ["host_event"],
  }), (error) => error instanceof DomainError && error.code === "CELL_OCCUPIED");
  assert.equal(world.plotView(10, 10).available, false);
  assert.equal(world.plotView(10, 10).standingLocationId, "commons");

  // The cell beside it is perfectly buildable.
  assert.equal(world.plotView(11, 10).available, true);
});

test("putting a night on is work, and a lavish one exhausts whoever throws it", () => {
  // Hosting was free. The pilot's only proprietor answered by creating five events in nine
  // real minutes - two of them three seconds apart - every one at her building's ceiling,
  // because an announcement that costs nothing is worth making again immediately.
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;
  const energy = () => world.getObservation("luca").character.energy;

  // The Hole promises music 90 + socializing 80 + luxury 20 = ambition 1.9.
  const before = energy();
  world.hostExperience("luca", {
    buildingId, title: "Opening Night", profile: { music: 90, socializing: 80, luxury: 20 },
    durationGameMinutes: 120, accessPrice: 30,
  });
  const lavish = before - energy();
  assert.equal(lavish, 39, "10 base + 15 per unit of ambition, on 1.9 of promise");
  assert.ok(lavish > makeConfig().energy.workCost, "hosting costs more than a shift of work");

  // A modest evening is cheap enough to throw often, which is the choice the price creates.
  const beforeModest = energy();
  world.hostExperience("luca", {
    buildingId, title: "Quiet Tuesday", profile: { music: 20 },
    durationGameMinutes: 60, accessPrice: 5, startsInGameMinutes: 120,
  });
  assert.equal(beforeModest - energy(), 13, "a small night promises little and costs little");

  // And the spam run is simply unaffordable now.
  // Booked into free slots so nothing clashes: the wall they hit is Energy, not the diary.
  assert.throws(() => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      world.hostExperience("luca", {
        buildingId, title: `Again ${attempt}`, profile: { music: 90, socializing: 80, luxury: 20 },
        durationGameMinutes: 120, accessPrice: 30,
        startsInGameMinutes: 180 + attempt * 130,
      });
    }
  }, (error) => error instanceof DomainError && error.code === "INSUFFICIENT_ENERGY");
});

test("the host is told what a night will cost before choosing its profile", () => {
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());

  const offer = world.getObservation("luca").availableActions
    .find((action) => action.type === "host_experience");
  assert.ok(offer, "the proprietor is offered hosting");
  assert.equal(offer.hostingBaseEnergyCost, 10);
  assert.equal(offer.hostingEnergyPerAmbition, 15);
  assert.equal(offer.hostingEnergyCostAtCeiling, 39,
    "what this building's own profile would cost to deliver in full");
  assert.equal(offer.energy, world.getObservation("luca").character.energy,
    "against what the host actually has");
});

test("a building hosts one night at a time", () => {
  // Four overlapping experiences ran in a room that seats ten. Two nights sharing a building
  // and an hour is not a richer programme, it is the same crowd counted twice.
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;

  world.hostExperience("luca", {
    buildingId, title: "Opening Night", profile: { music: 30 },
    durationGameMinutes: 120, accessPrice: 10,
  });

  for (const [when, why] of [[0, "starting at the same moment"], [60, "starting midway through"]]) {
    assert.throws(() => world.hostExperience("luca", {
      buildingId, title: "Clash", profile: { music: 30 },
      durationGameMinutes: 120, accessPrice: 10, startsInGameMinutes: when,
    }), (error) => error instanceof DomainError && error.code === "BUILDING_ALREADY_BOOKED", why);
  }

  // The clash names the night already booked, so the host can pick another slot.
  try {
    world.hostExperience("luca", {
      buildingId, title: "Clash", profile: { music: 30 }, durationGameMinutes: 60,
    });
  } catch (error) {
    assert.match(error.message, /Opening Night/);
  }

  // The slot after it is free, and a second building of one's own is unaffected.
  const later = world.hostExperience("luca", {
    buildingId, title: "Afters", profile: { music: 30 },
    durationGameMinutes: 60, accessPrice: 10, startsInGameMinutes: 120,
  });
  assert.equal(later.data.title, "Afters");
});

test("the diary is disclosed, so the next free slot can be chosen without being refused", () => {
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;

  const clear = world.getObservation("luca").availableActions
    .find((action) => action.type === "host_experience");
  assert.equal(clear.bookedUntil, null, "an empty diary says so");

  const night = world.hostExperience("luca", {
    buildingId, title: "Opening Night", profile: { music: 30 }, durationGameMinutes: 120,
  });
  const booked = world.getObservation("luca").availableActions
    .find((action) => action.type === "host_experience");
  assert.equal(booked.bookedUntil, night.data.endsAt,
    "and a taken room says until when, which is what startsInGameMinutes needs");
});

test("a proprietor employs out of the takings, and pins the notice in a square", () => {
  // AIT-1602. A venue earned from tickets and employed nobody, so credits pooled inside
  // buildings and stopped circulating. The notice cannot go inside the premises: a venue is
  // shut whenever nothing is on, so nobody would ever be standing there to read it.
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;
  const building = () => world.state.buildings.get(buildingId);

  // Door money first: it lands in the proprietor's wallet, and the wage is paid from there.
  world.hostExperience("luca", {
    buildingId, title: "Opening Night", profile: { music: 30 },
    durationGameMinutes: 120, accessPrice: 40,
  });
  // Anna has to walk there first - the doors are open now that something is on.
  const eventId = world.state.gatherings.values().next().value.id;
  world.startMove("anna", building().locationId);
  clock.advanceGameMinutes(25);
  world.advanceTo(clock.now());
  world.joinExperience("anna", eventId);
  const lucaAfterDoor = world.getObservation("luca").character.credits;
  assert.equal(building().revenue, 40, "the door money is recorded as the venue's revenue");

  const offer = world.getObservation("luca").availableActions
    .find((action) => action.type === "publish_role");
  assert.ok(offer, "an active building that can create jobs offers the role");
  assert.equal(offer.fundedFrom, "proprietor_wallet");
  assert.equal(offer.availableCredits, lucaAfterDoor, "and the purse it names is the proprietor's own wallet");
  assert.ok(offer.boardChoices.every((choice) => choice.locationId !== buildingId),
    "and the boards on offer are public squares, never the premises");

  assert.throws(() => world.publishRole("luca", {
    buildingId, boardLocationId: buildingId, title: "Door staff",
    durationGameMinutes: 30, wage: 20,
  }), (error) => error instanceof DomainError && error.code === "BOARD_NOT_PUBLIC");

  assert.throws(() => world.publishRole("luca", {
    buildingId, boardLocationId: "commons", title: "Door staff",
    durationGameMinutes: 30, wage: lucaAfterDoor + 1000,
  }), (error) => error instanceof DomainError && error.code === "INSUFFICIENT_CREDITS");

  const role = world.publishRole("luca", {
    buildingId, boardLocationId: "commons", title: "Work the door",
    description: "Check the list, keep the room right.", requirements: { social: 20 },
    durationGameMinutes: 30, wage: 25,
  });
  assert.equal(role.data.fundingSourceType, "building");
  assert.equal(role.data.boardLocationId, "commons", "read in the square");
  assert.equal(role.data.locationId, buildingId, "worked at the building");
  assert.equal(world.getObservation("luca").character.credits, lucaAfterDoor - 25,
    "and the wage is reserved out of the proprietor's own wallet");
});

test("the contributor loop closes: takings become a wage, a square becomes a hire", () => {
  // The whole chain the three stories add, end to end. It was assembled from parts that each
  // passed their own tests and still did not connect: acceptance was gated on the work site
  // rather than the board, and publicJob dropped boardLocationId, so every building role
  // read as WRONG_LOCATION to the one person standing where it was advertised.
  const { world, clock } = cityWorld();
  const started = buildTheHole(world);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const buildingId = started.data.buildingId;
  const building = () => world.state.buildings.get(buildingId);
  // Anna carries no skills in this world, and the role asks for some - so the loop needs
  // someone who actually meets the bar, which is the point of the bar.
  world.createCharacter({
    id: "tomas", name: "Tomas", locationId: "homes", credits: 40,
    personality: ["Steady"], goal: "Earn a living.", skills: { social: 30 },
  });
  const tomas = () => world.getObservation("tomas").character;

  const lucaBeforeRole = world.getObservation("luca").character.credits;
  const role = world.publishRole("luca", {
    buildingId, boardLocationId: "commons", title: "Work the door",
    description: "Check the list, keep the room right.",
    requirements: { social: 20 }, durationGameMinutes: 20, wage: 40,
  });
  assert.equal(world.getObservation("luca").character.credits, lucaBeforeRole - 40,
    "the wage is reserved out of the proprietor's wallet");

  // Tomas is in the square where the notice hangs, so he can read it and answer it - even
  // though the venue itself is shut, which is exactly why the notice is not inside it. A
  // resident-created role is applied for, not taken: the proprietor keeps the choice.
  world.startMove("tomas", "commons");
  clock.advanceGameMinutes(15);
  world.advanceTo(clock.now());
  const notice = world.getObservation("tomas").availableActions
    .find((action) => action.type === "apply_for_role" && action.jobId === role.data.id);
  assert.ok(notice, "the notice is readable where it was pinned");
  assert.equal(notice.compensation, 40);
  assert.equal(notice.locationId, building().locationId, "and it says where the work happens");
  assert.deepEqual(notice.skillGains, [{ skill: "social", gain: 2, ceiling: 40 }],
    "including what doing it would teach him");
  assert.equal(notice.hiring, "application", "and how it is answered");
  assert.throws(() => world.acceptJob("tomas", role.data.id),
    (error) => error instanceof DomainError && error.code === "ROLE_REQUIRES_APPLICATION",
    "the board cannot be raced past the proprietor's choice");

  world.applyForRole("tomas", role.data.id);
  const desk = world.getObservation("luca").availableActions
    .find((action) => action.type === "select_applicant" && action.jobId === role.data.id);
  assert.ok(desk, "the proprietor is offered the choice wherever he stands");
  assert.equal(desk.applications.length, 1);
  assert.equal(desk.applications[0].candidateId, "tomas");
  assert.equal(typeof desk.applications[0].reputation.general, "number",
    "each application carries the candidate's verified track record");
  assert.equal(desk.applications[0].score, undefined, "and the server ranks nobody");
  world.selectApplicant("luca", role.data.id, desk.applications[0].applicationId);

  // Staff get through a shut door: a venue that hired someone and locked them out could
  // never be staffed.
  world.startMove("tomas", building().locationId);
  clock.advanceGameMinutes(25);
  world.advanceTo(clock.now());
  assert.equal(tomas().locationId, building().locationId);

  const before = tomas().credits;
  const socialBefore = tomas().skills.social;
  world.startJob("tomas", role.data.id);
  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());

  assert.equal(tomas().credits - before, 40, "the reserved wage paid him in full");
  assert.equal(tomas().skills.social, socialBefore + 2, "and the work taught him something");
  assert.equal(world.getObservation("luca").character.credits, lucaBeforeRole - 40,
    "and the settled wage came out of that one reservation, never a second charge");
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { activateWorldConfiguration, loadWorldConfiguration } from "../src/config/world-configuration.js";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

const BASELINE_SOFT_BUDGET_BYTES = 8 * 1024;
const BASELINE_HARD_CEILING_BYTES = 16 * 1024;

// The checked-in seven-character pilot world: 7 residents, 4 locations, 20 jobs.
// The point of using it rather than a fixture is that the budget assertions below
// are then measured against the world the pilot actually runs.
function pilotWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config, clock });
  activateWorldConfiguration(world, loadWorldConfiguration(resolve("config/world.local-5.json")));
  return { world, clock };
}

// A world whose opportunity count the test controls exactly, so the delta cap can be
// probed at its boundary instead of relying on the pilot happening to publish twenty.
function countedWorld(openJobs) {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config, clock });
  world.defineLocation({ id: "commons", name: "Commons" });
  world.createCharacter({
    id: "mira", name: "Mira", locationId: "commons", credits: 10_000,
    personality: ["Curious"], goal: "Find something worth doing.",
  });
  for (let index = 1; index <= openJobs; index += 1) {
    world.createJob({
      creatorId: "mira", id: `job-${String(index).padStart(2, "0")}`,
      title: `Task ${index}`, locationId: "commons", durationGameMinutes: 20, compensation: 10,
    });
  }
  return world;
}

function bytes(payload) {
  return JSON.stringify(payload).length;
}

test("a progressive baseline fits the budget while a catalog of blocked items exists", () => {
  const { world } = pilotWorld();
  const characterIds = world.getPublicState().characters.map((character) => character.id);
  const caughtUp = world.currentStateVersion();

  const opportunities = world.inspectContext(characterIds[0], { resource: "opportunities" });
  assert.ok(opportunities.count >= 20, `expected the pilot catalog, got ${opportunities.count} items`);
  assert.ok(opportunities.blockedCount > 0, "the budget claim only means something with blocked items present");

  let fullTotal = 0;
  let steadyTotal = 0;
  for (const characterId of characterIds) {
    const full = bytes(world.getObservation(characterId));
    // A cold start has every summary marked changed, which is the worst case the
    // hard ceiling exists for.
    const cold = bytes(world.getObservation(characterId, { contextMode: "progressive" }));
    // Steady state: the runtime echoes the contextVersion it already holds.
    const steady = bytes(world.getObservation(characterId, {
      contextMode: "progressive", contextVersion: caughtUp,
    }));
    assert.ok(cold < BASELINE_HARD_CEILING_BYTES,
      `cold baseline for ${characterId} is ${cold} bytes, over the ${BASELINE_HARD_CEILING_BYTES} ceiling`);
    fullTotal += full;
    steadyTotal += steady;
  }

  const steadyAverage = Math.round(steadyTotal / characterIds.length);
  assert.ok(steadyAverage < BASELINE_SOFT_BUDGET_BYTES,
    `steady-state baseline averages ${steadyAverage} bytes, over the ${BASELINE_SOFT_BUDGET_BYTES} soft budget`);
  assert.ok(steadyAverage < Math.round(fullTotal / characterIds.length) / 4,
    "the whole point is a large reduction, not a marginal one");
});

test("progressive and full disclose the same known items for the same world state", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;

  const full = world.getObservation(characterId);
  const progressive = world.getObservation(characterId, { contextMode: "progressive" });

  const catalogJobIds = world.inspectContext(characterId, { resource: "opportunities", limit: 50 })
    .items.map((job) => job.id).sort();
  assert.deepEqual(catalogJobIds, full.availableJobs.map((job) => job.id).sort(),
    "the requested catalog must expose exactly the opportunities the full observation embedded");

  const catalogEventIds = world.inspectContext(characterId, { resource: "experiences", limit: 50 })
    .items.map((item) => item.id).sort();
  assert.deepEqual(catalogEventIds, full.upcomingEvents.map((item) => item.id).sort());

  // The same action types, and for the enumerated ones the same targets: progressive
  // mode makes affordances terser, it never removes an option the character had.
  const types = (observation) => [...new Set(observation.availableActions.map((action) => action.type))].sort();
  assert.deepEqual(types(progressive), types(full));

  const targets = (observation, type, key) => observation.availableActions
    .filter((action) => action.type === type).map((action) => action[key]).sort();
  for (const [type, key] of [["accept_job", "jobId"], ["move", "destinationId"], ["attend_event", "eventId"], ["start_conversation", "targetCharacterId"]]) {
    assert.deepEqual(targets(progressive, type, key), targets(full, type, key), `${type} targets differ`);
  }
  assert.equal(progressive.stateVersion, full.stateVersion);

  // And the blocked ones stay blocked, with the same primary reason.
  const blockedIn = (observation) => Object.fromEntries(observation.availableActions
    .filter((action) => action.feasibility?.status === "blocked")
    .map((action) => [action.jobId ?? action.eventId ?? action.targetCharacterId, action.feasibility.blockingCode]));
  assert.deepEqual(blockedIn(progressive), blockedIn(full));
});

test("the collapsed invitation affordance still reaches every pair full mode enumerated", () => {
  const { world } = pilotWorld();
  const characterId = "pilot-01";

  const full = world.getObservation(characterId);
  const progressive = world.getObservation(characterId, { contextMode: "progressive" });
  const enumerated = full.availableActions.filter((action) => action.type === "send_invitation");
  const envelopes = progressive.availableActions.filter((action) => action.type === "send_invitation");

  assert.ok(enumerated.length > 1, "full mode enumerates the cross-product");
  assert.equal(envelopes.length, 1, "progressive mode declares the envelope once");

  // Every identifier the cross-product spelled out must still be sourceable from
  // somewhere the agent holds, or collapsing would have removed a real option.
  const reachableTargets = new Set([
    ...progressive.nearby.map((person) => person.id),
    ...world.inspectContext(characterId, { resource: "people", limit: 50 }).items.map((person) => person.id),
  ]);
  const reachableDestinations = new Set([
    progressive.character.locationId,
    ...progressive.availableActions.filter((action) => action.type === "move").map((action) => action.destinationId),
    ...world.inspectContext(characterId, { resource: "experiences", limit: 50 }).items.map((item) => item.id),
  ]);

  for (const offer of enumerated) {
    assert.ok(reachableTargets.has(offer.targetCharacterId),
      `target ${offer.targetCharacterId} would be unreachable after collapsing`);
    assert.ok(reachableDestinations.has(offer.destinationId),
      `destination ${offer.destinationId} would be unreachable after collapsing`);
    assert.ok(envelopes[0].destinationTypes.includes(offer.destinationType));
  }

  // And the envelope carries the constraints the enumeration used to imply.
  assert.equal(envelopes[0].openInvitationsRemaining, 3);
  assert.equal(envelopes[0].locationLeadWorldMinutes, 30);
  assert.equal(envelopes[0].locationWindowWorldMinutes, 30);
});

test("the invitation affordance does not grow with the world", () => {
  const { world } = pilotWorld();
  const before = world.getObservation("pilot-01", { contextMode: "progressive" })
    .availableActions.filter((action) => action.type === "send_invitation");

  world.defineLocation({ id: "gallery", name: "Gallery" });
  world.defineLocation({ id: "market", name: "Market" });
  world.createEvent({
    id: "gallery-opening", title: "Gallery opening", locationId: "gallery",
    startsAt: "2042-01-01T10:00:00.000Z", endsAt: "2042-01-01T12:00:00.000Z",
  });

  const after = world.getObservation("pilot-01", { contextMode: "progressive" })
    .availableActions.filter((action) => action.type === "send_invitation");

  assert.equal(before.length, 1);
  assert.equal(after.length, 1, "two more locations and an experience must not add affordances");
  assert.deepEqual(after, before, "the envelope is unchanged by world growth");
});

test("a summary reports blocked items rather than hiding them behind a low count", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;

  const summary = world.getObservation(characterId, { contextMode: "progressive" })
    .summaries.find((item) => item.resource === "opportunities");

  assert.ok(summary.count >= 20);
  assert.ok(summary.feasibleCount < summary.count,
    "the pilot world must contain opportunities this character cannot act on");
  assert.equal(summary.requestAction, "inspect_opportunities");
  assert.equal(summary.contextContractVersion, 1);
});

test("a catalog keeps blocked items with their blockers, and feasibleOnly reports what it removed", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;

  const everything = world.inspectContext(characterId, { resource: "opportunities", limit: 50 });
  const blocked = everything.items.filter((job) => job.feasibility.status === "blocked");
  assert.ok(blocked.length > 0);
  for (const job of blocked) {
    assert.ok(job.feasibility.blockingCodes.length > 0,
      `blocked opportunity ${job.id} must disclose why`);
  }

  const feasibleOnly = world.inspectContext(characterId, {
    resource: "opportunities", filters: { feasibleOnly: true }, limit: 50,
  });
  assert.equal(feasibleOnly.items.length, everything.feasibleCount);
  assert.equal(feasibleOnly.blockedOmitted, everything.blockedCount);
  assert.ok(feasibleOnly.items.every((job) => job.feasibility.status !== "blocked"));
  assert.equal(everything.blockedOmitted, 0, "an unfiltered catalog omits nothing");
});

test("a delta at the identifier cap still lists, and one past it invalidates", () => {
  const atCap = countedWorld(20).getContextSummaries("mira", 0)
    .find((item) => item.resource === "opportunities");
  assert.equal(atCap.count, 20);
  assert.equal(atCap.changedIds.length, 20, "exactly at the cap the delta is complete and must be sent");
  assert.equal(atCap.invalidation, null);

  // Twenty-one changed identifiers would be a partial delta that reads as complete,
  // so the runtime is told to re-request the catalog instead.
  const pastCap = countedWorld(21).getContextSummaries("mira", 0)
    .find((item) => item.resource === "opportunities");
  assert.equal(pastCap.count, 21);
  assert.equal(pastCap.changedIds, null);
  assert.equal(pastCap.changeKinds, null);
  assert.equal(pastCap.invalidation, "SUMMARY_OVERFLOW");
});

test("a delta below the cap lists exactly what changed", () => {
  const world = countedWorld(3);
  const before = world.currentStateVersion();

  const job = world.createJob({
    creatorId: "mira", id: "job-04", title: "Task 4",
    locationId: "commons", durationGameMinutes: 20, compensation: 10,
  });

  const summary = world.getContextSummaries("mira", before)
    .find((item) => item.resource === "opportunities");
  assert.deepEqual(summary.changedIds, ["job-04"], "only the new opportunity changed");
  assert.equal(summary.changeKinds["job-04"], "published");
  assert.equal(summary.invalidation, null);
  assert.ok(summary.catalogVersion >= job.sequence);
  assert.equal(summary.count, 4);
});

test("publishing a job without an identifier is rejected", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;

  assert.throws(
    () => world.publishJob({
      creatorId: characterId, fundingSourceType: "character", fundingSourceId: characterId,
      title: "Nameless work", locationId: "archive", durationGameMinutes: 20,
      compensation: 10, requirements: {}, availableCredits: 1000, visibility: "public",
    }),
    (error) => error instanceof DomainError && error.code === "INVALID_ID",
    "a job with no id would be keyed undefined and unreachable",
  );
});

test("requesting a catalog is read-only and recorded", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;
  const before = world.getObservation(characterId).character;

  world.inspectContext(characterId, { resource: "opportunities" });
  world.inspectContext(characterId, { resource: "opportunities" });

  const after = world.getObservation(characterId).character;
  assert.equal(after.energy, before.energy, "inspecting must not spend energy");
  assert.equal(after.credits, before.credits, "inspecting must not move credits");
  assert.equal(after.activity, before.activity);

  const recorded = world.history.filter((event) => event.type === "DECISION_CONTEXT_REQUESTED");
  assert.equal(recorded.length, 2, "each request is recorded for telemetry");
  assert.equal(recorded[0].data.resource, "opportunities");
  assert.ok(recorded[0].data.bytes > 0);
  assert.equal(recorded[0].data.contextContractVersion, 1);
});

test("catalog telemetry never advances the character projection version", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;
  const before = world.characterStateVersion(characterId);

  world.inspectContext(characterId, { resource: "people" });

  assert.equal(world.characterStateVersion(characterId), before,
    "a read must not invalidate the projection the agent is holding");
});

test("catalog ordering is deterministic and neutral", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;

  const first = world.inspectContext(characterId, { resource: "opportunities", limit: 50 });
  const second = world.inspectContext(characterId, { resource: "opportunities", limit: 50 });
  assert.deepEqual(first.items.map((job) => job.id), second.items.map((job) => job.id));
  assert.deepEqual(
    first.items.map((job) => job.id),
    [...first.items.map((job) => job.id)].sort(),
    "opportunities order by identifier, not by predicted usefulness",
  );

  const experiences = world.inspectContext(characterId, { resource: "experiences", limit: 50 }).items;
  const startTimes = experiences.map((item) => new Date(item.startsAt).getTime());
  assert.deepEqual(startTimes, [...startTimes].sort((left, right) => left - right),
    "time-bounded resources order by start time");
});

test("pagination reports truncation without dropping items", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;

  const page = world.inspectContext(characterId, { resource: "opportunities", limit: 5 });
  assert.equal(page.items.length, 5);
  assert.ok(page.truncated);
  assert.equal(page.nextOffset, 5);

  const collected = [];
  let offset = 0;
  for (let guard = 0; guard < 20 && offset !== null; guard += 1) {
    const next = world.inspectContext(characterId, { resource: "opportunities", limit: 5, offset });
    collected.push(...next.items.map((job) => job.id));
    offset = next.nextOffset;
  }
  const everything = world.inspectContext(characterId, { resource: "opportunities", limit: 50 });
  assert.deepEqual(collected, everything.items.map((job) => job.id),
    "paging through must yield exactly the unpaged result");
});

test("the catalog rejects an unknown resource, filter, mode, or page size", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;
  const rejects = (code, run) => assert.throws(run,
    (error) => error instanceof DomainError && error.code === code, `expected ${code}`);

  rejects("UNKNOWN_CONTEXT_RESOURCE", () => world.inspectContext(characterId, { resource: "buildings" }));
  rejects("UNKNOWN_CONTEXT_FILTER", () => world.inspectContext(characterId, {
    resource: "opportunities", filters: { organizerId: "mira" },
  }));
  rejects("INVALID_PAGE_SIZE", () => world.inspectContext(characterId, { resource: "opportunities", limit: 51 }));
  rejects("INVALID_CATALOG_OFFSET", () => world.inspectContext(characterId, { resource: "opportunities", offset: -1 }));
  rejects("INVALID_CONTEXT_MODE", () => world.getObservation(characterId, { contextMode: "compact" }));
});

test("a people catalog exposes only this character's own outgoing relationships", () => {
  const { world } = pilotWorld();
  const [first, second] = world.getPublicState().characters.map((character) => character.id);

  const mine = world.inspectContext(first, { resource: "people", limit: 50 });
  assert.ok(mine.items.every((person) => person.id !== first), "a character is not in its own people catalog");
  const entry = mine.items.find((person) => person.id === second);
  if (entry) {
    assert.deepEqual(entry.relationship, world.getRelationship(first, second));
    assert.notEqual(entry.relationship, world.getRelationship(second, first),
      "the reverse direction must not be disclosed",
    );
  }
});

test("the rules manifest states the context discipline under a new version", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;
  const manifest = world.getAgentRules(characterId);

  assert.notEqual(manifest.version, "agent-rules-v1", "a manifest body change ships under a new version");
  assert.equal(manifest.version, "agent-rules-v2");
  assert.equal(manifest.context.contractVersion, 1);
  assert.deepEqual(manifest.context.requestable, ["opportunities", "experiences", "people"]);
  for (const field of ["instruction", "summaryReading", "caching", "authority"]) {
    assert.equal(typeof manifest.context[field], "string");
    assert.ok(manifest.context[field].length > 0, `context.${field} must say something`);
  }
});

test("a progressive observation omits the manifest body but keeps it verifiable", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;

  const full = world.getObservation(characterId);
  const progressive = world.getObservation(characterId, { contextMode: "progressive" });

  assert.ok(full.rules, "full mode still embeds the manifest");
  assert.equal(progressive.rules, undefined, "progressive mode omits the cached body");
  assert.equal(progressive.rulesVersion, full.rulesVersion);
  assert.equal(progressive.rulesDigest, full.rulesDigest);
  assert.ok(progressive.rulesDigest.length > 0, "the digest lets a runtime validate its cache");
});

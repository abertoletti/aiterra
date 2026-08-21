import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { activateWorldConfiguration, loadWorldConfiguration } from "../src/config/world-configuration.js";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";
import { buildDecisionMessages } from "../src/agents/decision-planner.js";
import { settleEveryone } from "./support/pilot.js";

const BASELINE_SOFT_BUDGET_BYTES = 20 * 1024;
const BASELINE_HARD_CEILING_BYTES = 32 * 1024;

// The checked-in seven-character pilot world: 7 residents, 4 locations, 20 jobs.
// The point of using it rather than a fixture is that the budget assertions below
// are then measured against the world the pilot actually runs.
function pilotWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config, clock });
  activateWorldConfiguration(world, loadWorldConfiguration(resolve("config/world.local-5.json")));
  settleEveryone(world);
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

  // Five notices per square, and the catalog reads the same board the observation does.
  const opportunities = world.inspectContext(characterIds[0], { resource: "opportunities" });
  assert.equal(opportunities.count, 5, `expected one square's board, got ${opportunities.count} items`);
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
  assert.ok(steadyAverage < Math.round(fullTotal / characterIds.length) / 2,
    "the whole point is a large reduction, not a marginal one");
});

test("an offered opportunity carries the whole notice, so work is never chosen blind", () => {
  const { world } = pilotWorld();
  const characterId = world.getPublicState().characters[0].id;

  for (const contextMode of ["full", "progressive"]) {
    const observation = world.getObservation(characterId, { contextMode });
    // One square's board, split between what can be taken now and what needs something
    // first. Both halves are a notice and both must be readable in full.
    const offers = [...observation.availableActions, ...observation.opportunities]
      .filter((entry) => entry.type === "accept_job");
    assert.equal(offers.length, 5, `${contextMode} must offer this square's whole board`);
    for (const offer of offers) {
      // The first pilot accepted four jobs and requested no catalog, because an
      // affordance sufficient to act on removes the reason to ask. These are the
      // fields that distinguish one notice from another.
      for (const field of ["title", "compensation", "durationGameMinutes", "executionEnergyCost", "requirements", "offerExpiresAt"]) {
        assert.notEqual(offer[field], undefined,
          `${contextMode}: accept_job must disclose ${field} or the choice is uninformed`);
      }
    }
    assert.ok(observation.availableActions.some((action) => action.type === "accept_job"),
      `${contextMode}: work that can be taken now sits in the menu`);
    // Pay genuinely varies across the board, which is why it has to be disclosed.
    assert.ok(new Set(offers.map((offer) => offer.compensation)).size > 1,
      "the pilot board pays different amounts for different work");
  }
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
  assert.equal(catalogJobIds.length, 5, "which is this square's board and no other");

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

test("the invitation affordance is one aimed declaration, in either context mode", () => {
  const { world } = pilotWorld();
  const characterId = "pilot-01";

  for (const contextMode of ["full", "progressive"]) {
    const observation = world.getObservation(characterId, { contextMode });
    const offers = observation.availableActions.filter((action) => action.type === "send_invitation");

    assert.equal(offers.length, 1, `${contextMode} mode must declare the envelope once`);
    assert.equal(offers[0].targetCharacterId, undefined, "the affordance names no target");
    assert.equal(offers[0].destinationId, undefined, "the affordance names no destination");
    assert.deepEqual(offers[0].destinationTypes, ["location", "event"]);
    assert.equal(offers[0].openInvitationsRemaining, 3);
    assert.equal(offers[0].locationLeadWorldMinutes, 30);
    assert.equal(offers[0].locationWindowWorldMinutes, 30);
  }
});

test("everything the invitation envelope permits is sourceable and actually accepted", () => {
  const { world } = pilotWorld();
  // pilot-05 starts at the market with company; the envelope test needs someone nearby to invite.
  const characterId = "pilot-05";
  // The world ships no experiences: only residents host now. A protocol test should not
  // depend on the pilot world happening to carry one, so it supplies its own.
  world.createEvent({
    id: "invitable-night", title: "A night to invite someone to", locationId: "market",
    startsAt: world.clock.now(),
    endsAt: new Date(world.clock.now().getTime() + 90 * 60_000),
    profile: { socializing: 70 },
  });
  const observation = world.getObservation(characterId, { contextMode: "progressive" });

  // The parameters the agent must supply come from context it already holds.
  const targets = [
    ...observation.nearby.map((person) => person.id),
    ...world.inspectContext(characterId, { resource: "people", limit: 50 }).items.map((person) => person.id),
  ];
  const experiences = world.inspectContext(characterId, { resource: "experiences", limit: 50 }).items;
  assert.ok(targets.length > 0, "the agent knows who it could invite");
  assert.ok(experiences.length > 0, "the agent knows where it could invite them");

  // And the server accepts a combination assembled purely from that context, which
  // is the property that makes the declaration safe rather than merely smaller.
  const sent = world.sendInvitation(characterId, targets[0], {
    destinationType: "event", destinationId: experiences[0].id, message: "Join me there.",
  });
  assert.equal(sent.type, "INVITATION_SENT");
  assert.equal(sent.data.eventId, experiences[0].id);

  // A location the character knows works the same way.
  const toLocation = world.sendInvitation(characterId, targets[0], {
    destinationType: "location", destinationId: observation.character.locationId, message: "Stay here with me.",
  });
  assert.equal(toLocation.data.locationId, observation.character.locationId);
});

test("the invitation affordance does not grow with the world", () => {
  const { world } = pilotWorld();
  const before = world.getObservation("pilot-01", { contextMode: "progressive" })
    .availableActions.filter((action) => action.type === "send_invitation");

  world.defineLocation({ id: "gallery", name: "Gallery" });
  world.defineLocation({ id: "bazaar", name: "Bazaar" });
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

  assert.equal(summary.count, 5, "one board, not the whole city");
  assert.ok(summary.feasibleCount < summary.count,
    "the pilot world must contain opportunities this character cannot act on");
  assert.equal(summary.requestAction, "inspect_opportunities");
  assert.equal(summary.contextContractVersion, 3);
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
  assert.equal(recorded[0].data.contextContractVersion, 3);
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

  // One board holds five notices, so paginate below that to see truncation at all.
  const page = world.inspectContext(characterId, { resource: "opportunities", limit: 3 });
  assert.equal(page.items.length, 3);
  assert.ok(page.truncated);
  assert.equal(page.nextOffset, 3);

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

  rejects("UNKNOWN_CONTEXT_RESOURCE", () => world.inspectContext(characterId, { resource: "weather" }));
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
  assert.equal(manifest.version, "agent-rules-v6");
  assert.equal(manifest.context.contractVersion, 3);
  assert.deepEqual(manifest.context.requestable,
    ["opportunities", "experiences", "plots", "buildings", "people", "courses"]);
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

test("a full observation carries the job board, and both modes carry the city", () => {
  const { world } = pilotWorld();
  const characterId = "pilot-01";

  // availableJobs was silently dropped from the full-mode block in one commit and only
  // a downstream length assertion caught it, so it gets its own guard.
  const full = world.getObservation(characterId);
  assert.ok(Array.isArray(full.availableJobs), "full mode must embed the job board");
  assert.equal(full.availableJobs.length, 5, "the board of the square the character stands in");
  assert.ok(Array.isArray(full.jobBoards), "and where the other boards are");
  assert.equal(full.jobBoards.length, 4);
  assert.ok(Array.isArray(full.upcomingEvents));

  const progressive = world.getObservation(characterId, { contextMode: "progressive" });
  assert.equal(progressive.availableJobs, undefined, "progressive makes it requestable instead");

  // cityTonight is in both, because three runs showed nobody fetches what they must ask
  // for, and it is what turns a room into a city.
  for (const observation of [full, progressive]) {
    assert.ok(Array.isArray(observation.cityTonight));
  }
});

test("what the observation computes actually reaches the model", () => {
  const { world } = pilotWorld();
  const observation = world.getObservation("pilot-01", { contextMode: "progressive" });
  const context = JSON.parse(buildDecisionMessages(observation)[1].content);

  // cityTonight was computed into every observation, named three times in the prompt,
  // and never copied into the context object. The model was told to consult a field it
  // had never seen, and asked for the experiences catalog 65 times to grope for it.
  assert.notEqual(context.cityTonight, undefined,
    "a field the prompt names must survive prompt assembly");
  assert.deepEqual(context.cityTonight, observation.cityTonight);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

const cursorSecret = "test-owner-cursor-secret";

test("owner feed uses a scoped, stable keyset snapshot and hides the reverse relationship", () => {
  const { world } = storyWorld();
  world.establishRelationship({ fromId: "sara", toId: "jack", affinity: 90, trust: 80, tension: 0 });
  const conversation = world.startConversation("jack", "sara", "Hello");
  world.sendMessage("sara", conversation.data.conversationId, "Hello Jack");
  world.endConversation("jack", conversation.data.conversationId);

  const first = world.getOwnerFeed({
    ownerId: "owner-jack", characterId: "jack", limit: 2, cursorSecret,
    realNow: new Date("2026-08-18T10:00:00.000Z"),
  });
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  assert.ok(first.items[0].worldSequence > first.items[1].worldSequence);
  assert.ok(!first.items.some((item) => item.type === "RELATIONSHIP_CREATED"
    && item.peopleIds.includes("sara") && item.details.affinity === 90));

  const snapshot = first.snapshotThroughSequence;
  world.startMove("jack", "home");
  const second = world.getOwnerFeed({
    ownerId: "owner-jack", characterId: "jack", limit: 100,
    cursor: first.nextCursor, cursorSecret,
    realNow: new Date("2026-08-18T10:01:00.000Z"),
  });
  const combinedIds = [...first.items, ...second.items].map((item) => item.id);
  assert.equal(new Set(combinedIds).size, combinedIds.length);
  assert.ok(second.items.every((item) => item.worldSequence <= snapshot), "new events stay outside the fixed snapshot");

  assert.throws(
    () => world.getOwnerFeed({ ownerId: "owner-jack", characterId: "jack", cursor: `${first.nextCursor}x`, cursorSecret }),
    (error) => error instanceof DomainError && error.code === "INVALID_CURSOR" && error.status === 400,
  );
  assert.throws(
    () => world.getOwnerFeed({ ownerId: "owner-sara", characterId: "sara", cursor: first.nextCursor, cursorSecret }),
    (error) => error instanceof DomainError && error.code === "CURSOR_SCOPE_MISMATCH" && error.status === 403,
  );
  assert.throws(
    () => world.getOwnerFeed({
      ownerId: "owner-jack", characterId: "jack", cursor: first.nextCursor, cursorSecret,
      realNow: new Date("2026-08-19T10:00:01.000Z"),
    }),
    (error) => error instanceof DomainError && error.code === "CURSOR_EXPIRED" && error.status === 410,
  );
});

test("return summary is factual, source-linked, and supports one interest rating", () => {
  const { world, clock } = storyWorld();
  const conversation = world.startConversation("jack", "sara", "Did anything happen?");
  world.sendMessage("sara", conversation.data.conversationId, "The workshop opens at noon", [{
    id: "workshop-hours", claim: "The workshop opens at noon", perceivedReliability: "high",
  }]);
  world.endConversation("jack", conversation.data.conversationId);
  world.appraiseInteraction("jack", "sara", "appreciated", { conversationId: conversation.data.conversationId });

  const summary = world.createReturnSummary({
    ownerId: "owner-jack", characterId: "jack",
    sinceWorldTime: "2042-01-01T09:00:00.000Z", throughWorldTime: clock.now(),
  });
  assert.ok(summary.highlights.length > 0);
  assert.ok(summary.highlights.every((highlight) => highlight.sourceEventIds.includes(highlight.id)));
  assert.doesNotMatch(JSON.stringify(summary), /felt|wanted|believed/i, "no undeclared motivation is invented");

  world.viewReturnSummary("owner-jack", "jack", summary.id);
  const detailId = summary.highlights[0].detailEventId;
  world.viewStoryDetail("owner-jack", "jack", detailId);
  world.rateStory("owner-jack", "jack", detailId, 5);
  assert.throws(
    () => world.rateStory("owner-jack", "jack", detailId, 4),
    (error) => error instanceof DomainError && error.code === "STORY_ALREADY_RATED",
  );
});

test("versioned metrics use exact event denominators and project causal story candidates", () => {
  const { world } = storyWorld();
  const conversation = world.startConversation("jack", "sara", "Hello Sara");
  const notification = world.getPendingNotificationEvents("sara")[0];
  world.markNotificationDelivered("sara", notification.id, new Date());
  world.sendMessage("sara", conversation.data.conversationId, "Hello Jack", [{
    id: "social-fact", claim: "Sara is available tomorrow", perceivedReliability: "medium",
  }]);
  world.endConversation("jack", conversation.data.conversationId);
  world.appraiseInteraction("jack", "sara", "appreciated", { conversationId: conversation.data.conversationId });

  const summary = world.createReturnSummary({
    ownerId: "owner-jack", characterId: "jack",
    sinceWorldTime: "2042-01-01T09:00:00.000Z", throughWorldTime: "2042-01-01T11:00:00.000Z",
  });
  world.viewReturnSummary("owner-jack", "jack", summary.id);
  const detailId = summary.highlights[0].detailEventId;
  world.viewStoryDetail("owner-jack", "jack", detailId);
  world.rateStory("owner-jack", "jack", detailId, 5);

  const metrics = world.getProductMetrics({ environment: "test", isTest: true, testRunId: "metrics-1" });
  assert.equal(metrics.dimensions.metricDefinitionVersion, 4);
  assert.deepEqual(metrics.selectedContext.selectionToFirstEngagementRate,
    { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(metrics.selectedContext.postDisclosureRejectionRate,
    { numerator: 0, denominator: 0, value: null });
  assert.deepEqual(metrics.selectedContext.invalidationsByCause, {});
  assert.deepEqual(metrics.socialLoop.interactionStartRate, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(metrics.socialLoop.onTimeConversationResponseRate, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(metrics.socialLoop.successfulConversationCompletionRate, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(metrics.socialLoop.persistentConsequenceRate, { numerator: 1, denominator: 1, value: 1 });
  assert.ok(metrics.stories.candidates.length >= 1);
  assert.deepEqual(metrics.ownerInterest.summaryOpenRate, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(metrics.ownerInterest.interestingStoryRate, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(metrics.ownerInterest.ratingResponseRate, { numerator: 1, denominator: 1, value: 1 });
});

function storyWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  let nextId = 1;
  const world = new World({
    store: new InMemoryEventStore(), config, clock,
    idGenerator: () => `owner-${nextId++}`,
  });
  world.defineLocation({ id: "home", name: "Home" });
  world.defineLocation({ id: "square", name: "Square" });
  world.createCharacter({ id: "jack", name: "Jack", locationId: "square" });
  world.createCharacter({ id: "sara", name: "Sara", locationId: "square" });
  return { world, clock };
}

test("money is conserved: every credit is in a purse, a till, an escrow, or the budget", () => {
  // The observer showed three of the four pots side by side with no total, so a reader added
  // them, got more than the bootstrap budget, and reasonably concluded the books were wrong.
  // They were not - escrow is held OUT of the budget and the residents' opening purses are a
  // second issuance - but nothing said so, and buildings were genuinely missing, which meant
  // the supply was under-reported the moment anyone built anything.
  const clock = new ManualClock("2042-01-01T09:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config: makeConfig(), clock });
  world.defineLocation({ id: "square", name: "Square", x: 5, y: 5 });
  world.bootstrapEconomy({ budgetId: "budget", credits: 10_000 });
  world.createCharacter({
    id: "vera", name: "Vera", locationId: "square", personality: [], goal: "Build.",
    credits: 2_000,
  });
  world.createCharacter({
    id: "nia", name: "Nia", locationId: "square", personality: [], goal: "Work.",
    credits: 300, skills: { social: 40 },
  });

  // With a bounded treasury the unspent budget is one of the pots; the supply is what has
  // been issued to residents plus what the city has actually put in, less what construction
  // and upkeep burned.
  const accounts = () => {
    const { overview } = world.getPublicState();
    return {
      supply: overview.moneySupply + overview.systemBudgetBalance,
      held: overview.characterCredits
        + overview.reservedCredits + overview.systemBudgetBalance,
    };
  };
  const conserved = (what) => {
    const { supply, held } = accounts();
    assert.equal(held, supply, `credits went missing or appeared ${what}`);
  };

  assert.equal(accounts().supply, 12_300, "10,000 to the city and 2,300 to two residents");
  conserved("at the start");

  // Publishing a job moves budget into escrow. Neither is spent.
  world.createSystemJob({
    budgetId: "budget", id: "sweep", title: "Sweep", locationId: "square",
    durationGameMinutes: 10, compensation: 90, requirements: { social: 30 },
  });
  conserved("when work is published");

  // Completing it moves escrow into a purse.
  world.acceptJob("nia", "sweep");
  world.startJob("nia", "sweep");
  clock.advanceGameMinutes(10);
  world.advanceTo(clock.now());
  assert.equal(world.getObservation("nia").character.credits, 390);
  conserved("when work is paid");

  // Building moves a purse into bricks - that money leaves the world, so the supply must
  // fall with it rather than the books breaking.
  const before = accounts().supply;
  const built = world.constructBuilding("vera", {
    x: 6, y: 6, width: 1, height: 1, name: "The Room", description: "A room.",
    profile: { music: 40 }, capabilities: ["host_event", "sell_access", "sell_service"],
  });
  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());
  assert.equal(accounts().supply, before - built.data.constructionCost,
    "construction spends credits out of existence, and the supply says so");
  conserved("after building");

  // Admission moves a purse into the proprietor's own wallet: one resident's credits become
  // another's, and the venue keeps a revenue ledger of what came through the door.
  const veraBeforeDoor = world.getObservation("vera").character.credits;
  const gathering = world.hostExperience("vera", {
    buildingId: built.data.buildingId, title: "A night", profile: { music: 40 },
    durationGameMinutes: 120, accessPrice: 25,
  });
  world.startMove("nia", world.state.buildings.get(built.data.buildingId).locationId);
  clock.advanceGameMinutes(10);
  world.advanceTo(clock.now());
  world.joinExperience("nia", gathering.data.id);
  assert.equal(world.getObservation("vera").character.credits, veraBeforeDoor + 25,
    "the door money lands in the proprietor's wallet");
  assert.equal(world.state.buildings.get(built.data.buildingId).revenue, 25,
    "and is recorded as the venue's revenue");
  conserved("when a venue takes money at the door");

  // Tuition is the newest movement: into the proprietor's wallet like admission, or back to
  // the treasury when the city itself taught the course. Both are reducer-moved, so both must
  // reconcile like every other credit.
  const foundations = world.config.courses.catalog.find((entry) => entry.id === "foundations");
  const taught = world.offerResidentCourse("vera", {
    buildingId: built.data.buildingId, boardLocationId: "square",
    catalogEntryId: "foundations", skill: "social",
    price: foundations.priceMinimum, title: "Working a room",
  });
  world.leaveExperience("nia", gathering.data.id);
  world.startMove("nia", "square");
  clock.advanceGameMinutes(10);
  world.advanceTo(clock.now());
  world.enrollInCourse("nia", taught.data.id);
  conserved("when tuition reaches a building till");

  const citySchool = world.offerCourse({
    id: "city-course", providerType: "city", providerId: "budget",
    locationId: "square", boardLocationId: "square",
    catalogEntryId: "foundations", skill: "business",
    price: foundations.priceMinimum, title: "The city teaches trade",
  });
  world.enrollInCourse("vera", citySchool.data.id);
  conserved("when tuition returns to the treasury");
});

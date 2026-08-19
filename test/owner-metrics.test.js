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
  assert.equal(metrics.dimensions.metricDefinitionVersion, 1);
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

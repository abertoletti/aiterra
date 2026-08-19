import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";
import { runVerticalSlice } from "../src/scenario.js";

// The value characterStateVersion returned before it was indexed: the sequence of
// the newest projecting event this character may reference, or 0 when none exists.
function scanCharacterStateVersion(world, characterId) {
  const nonProjecting = new Set([
    "AGENT_ACTION_PROCESSED", "RELEVANCE_EVALUATED", "OWNER_FEED_VIEWED",
    "RETURN_SUMMARY_VIEWED", "STORY_DETAIL_VIEWED", "STORY_INTEREST_RATED",
    "AGENT_EVENT_REPLAYED", "AGENT_CONNECTION_TESTED",
    "OPPORTUNITIES_VIEWED", "AGENT_RULES_REQUESTED",
  ]);
  return [...world.history].reverse().find((event) =>
    !nonProjecting.has(event.type) && world.characterMayReference(characterId, event))?.sequence ?? 0;
}

function buildWorld() {
  const config = makeConfig();
  const clock = new ManualClock("2042-06-12T20:00:00.000Z");
  const store = new InMemoryEventStore();
  const world = new World({ store, config, clock, idGenerator: sequentialIds() });
  runVerticalSlice(world, clock);
  return { world, store, config, clock };
}

test("the indexed character projection version equals a full history scan", () => {
  const { world } = buildWorld();
  const characterIds = [...world.getPublicState().characters.map((character) => character.id)];

  assert.ok(characterIds.length >= 3, "the slice must exercise several characters");
  assert.ok(world.history.length > 50, "the slice must produce enough history to be meaningful");

  for (const characterId of characterIds) {
    assert.equal(
      world.characterStateVersion(characterId),
      scanCharacterStateVersion(world, characterId),
      `indexed and scanned projection versions disagree for ${characterId}`,
    );
  }
});

test("the index agrees with a full scan after every single event of the slice", () => {
  const { world } = buildWorld();
  const characterIds = world.getPublicState().characters.map((character) => character.id);
  const config = makeConfig();
  const clock = new ManualClock("2042-06-12T20:00:00.000Z");

  // Replay the same history one event at a time and compare at every step, so an
  // ordering difference between the index and the scan cannot hide in the total.
  const replayed = new World({ store: new InMemoryEventStore(), config, clock });
  for (const event of world.history) {
    replayed.history.push(event);
    replayed.apply(event);
    for (const characterId of characterIds) {
      if (!replayed.state.characters.has(characterId)) continue;
      assert.equal(
        replayed.characterStateVersion(characterId),
        scanCharacterStateVersion(replayed, characterId),
        `divergence for ${characterId} at sequence ${event.sequence} (${event.type})`,
      );
    }
  }
});

test("a character created after a world-visible event still sees that event's sequence", () => {
  const config = makeConfig();
  const clock = new ManualClock("2042-06-12T20:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config, clock });

  world.defineLocation({ id: "commons", name: "Commons" });
  const gathering = world.createEvent({
    id: "welcome", title: "Welcome gathering", locationId: "commons",
    startsAt: "2042-06-12T21:00:00.000Z", endsAt: "2042-06-12T22:00:00.000Z",
  });
  const latecomer = world.createCharacter({
    id: "mira", name: "Mira", locationId: "commons",
    personality: ["Curious"],
    goal: "Learn who already lives here.",
  });

  assert.ok(gathering.sequence < latecomer.sequence, "the gathering precedes the character");
  assert.equal(
    world.characterStateVersion("mira"),
    scanCharacterStateVersion(world, "mira"),
    "an EVENT_CREATED recorded before a character still projects to that character",
  );
});

test("the projection version rebuilt from a restart matches the live world", () => {
  const { world, store, config } = buildWorld();
  const restarted = new World({
    store, config, clock: new ManualClock("2042-06-12T20:00:00.000Z"),
  });

  for (const character of world.getPublicState().characters) {
    assert.equal(
      restarted.characterStateVersion(character.id),
      world.characterStateVersion(character.id),
      `restart lost the projection version of ${character.id}`,
    );
  }
});

function sequentialIds() {
  let counter = 0;
  return () => `ev-${String(++counter).padStart(4, "0")}`;
}

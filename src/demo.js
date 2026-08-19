import { makeConfig } from "./domain/config.js";
import { ManualClock } from "./domain/clock.js";
import { World } from "./domain/world.js";
import { InMemoryEventStore } from "./infra/event-store.js";
import { runVerticalSlice } from "./scenario.js";

const config = makeConfig();
const clock = new ManualClock("2042-06-12T20:00:00.000Z");
const store = new InMemoryEventStore();
const world = new World({ store, config, clock });
runVerticalSlice(world, clock);

for (const item of world.getTimeline()) {
  console.log(`${item.at.slice(11, 16)}  ${item.text}`);
}

const jack = world.getObservation("jack").character;
const relationship = world.getRelationship("jack", "sara");
console.log(`\nJack: ${jack.credits} credits, ${jack.energy} energy, affinity to Sara ${relationship.affinity}, trust ${relationship.trust}, tension ${relationship.tension}.`);

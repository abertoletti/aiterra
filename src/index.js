import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AcceleratedWorldClock } from "./domain/clock.js";
import { makeConfig } from "./domain/config.js";
import { World } from "./domain/world.js";
import { activateWorldConfiguration, loadWorldConfiguration } from "./config/world-configuration.js";
import { JsonlEventStore } from "./infra/event-store.js";
import { bootstrapVerticalSlice } from "./scenario.js";
import { createHttpServer } from "./server.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = makeConfig({
  clock: { realHoursPerGameDay: Number(process.env.GAME_DAY_REAL_HOURS ?? 4) },
});
const clock = new AcceleratedWorldClock(config.clock);
const store = new JsonlEventStore(resolve(root, process.env.EVENT_LOG_PATH ?? ".data/world-events.jsonl"));
let seeded = null;
let world;
if (store.readAll().length === 0 && process.env.WORLD_CONFIG_PATH) {
  world = new World({ store, config, clock });
  const worldConfiguration = loadWorldConfiguration(resolve(root, process.env.WORLD_CONFIG_PATH));
  seeded = activateWorldConfiguration(world, worldConfiguration);
} else {
  seeded = bootstrapVerticalSlice({ store, config, gameNow: clock.now() });
  world = new World({ store, config, clock });
}

// Process due authoritative activities independently of any human or agent client.
const scheduler = setInterval(() => world.advanceTo(clock.now()), 1_000);
const demoAgentTokens = {
  jack: process.env.JACK_AGENT_TOKEN ?? "demo-jack-token",
  sara: process.env.SARA_AGENT_TOKEN ?? "demo-sara-token",
  luca: process.env.LUCA_AGENT_TOKEN ?? "demo-luca-token",
};
const demoOwnerTokens = {
  "jack-owner": process.env.JACK_OWNER_TOKEN ?? "demo-jack-owner-token",
  "sara-owner": process.env.SARA_OWNER_TOKEN ?? "demo-sara-owner-token",
  "luca-owner": process.env.LUCA_OWNER_TOKEN ?? "demo-luca-owner-token",
};
const demoOwnerCharacters = {
  "jack-owner": ["jack"], "sara-owner": ["sara"], "luca-owner": ["luca"],
};
const agentTokens = parseJsonEnvironment("AGENT_TOKENS_JSON", demoAgentTokens);
const ownerTokens = parseJsonEnvironment("OWNER_TOKENS_JSON", demoOwnerTokens);
const ownerCharacters = parseJsonEnvironment("OWNER_CHARACTERS_JSON", demoOwnerCharacters);
if (process.env.NODE_ENV === "production" && !process.env.OPERATOR_TOKEN) {
  throw new Error("OPERATOR_TOKEN is required in production");
}
const server = createHttpServer({
  world, agentTokens, ownerTokens, ownerCharacters,
  operatorToken: process.env.OPERATOR_TOKEN ?? null,
  cursorSecret: process.env.OWNER_FEED_CURSOR_SECRET ?? "demo-owner-cursor-secret-change-me",
  publicDir: resolve(root, "public"),
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST || undefined;

server.listen(port, host, () => {
  console.log(`Aiterra observer: http://${host ?? "localhost"}:${port}`);
  console.log(`World time: ${clock.now().toISOString()} (${config.clock.realHoursPerGameDay} real hours/game day)`);
  if (seeded) console.log(`Seeded world configuration ${seeded.version ?? "deterministic-demo"}.`);
  if (process.env.NODE_ENV !== "production") console.log("Demo tokens: demo-jack-token, demo-sara-token, demo-luca-token");
});

function shutdown() {
  clearInterval(scheduler);
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function parseJsonEnvironment(name, fallback) {
  if (!process.env[name]) return fallback;
  try {
    const value = JSON.parse(process.env[name]);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be a JSON object");
    return value;
  } catch (error) {
    throw new Error(`${name} is invalid: ${error.message}`);
  }
}

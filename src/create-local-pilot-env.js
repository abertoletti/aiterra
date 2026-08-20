import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputArgument = process.argv.indexOf("--output");
if (outputArgument >= 0 && !process.argv[outputArgument + 1]) throw new Error("--output requires a file path");
const outputPath = resolve(outputArgument >= 0 ? process.argv[outputArgument + 1] : ".env");
const upgradeSeven = process.argv.includes("--upgrade-seven");
if (existsSync(outputPath) && !upgradeSeven) throw new Error(`Refusing to overwrite existing environment file ${outputPath}`);

const characterIds = [
  "pilot-01", "pilot-02", "pilot-03", "pilot-04", "pilot-05",
  "pilot-06", "pilot-07", "pilot-08", "pilot-09", "pilot-10",
];
const agentTokens = Object.fromEntries(characterIds.map((id) => [id, secret()]));
const ownerTokens = Object.fromEntries(characterIds.map((id) => [`owner-${id}`, secret()]));
const ownerCharacters = Object.fromEntries(characterIds.map((id) => [`owner-${id}`, [id]]));
if (existsSync(outputPath) && upgradeSeven) {
  upgradeExistingEnvironment(outputPath);
  process.exit(0);
}
const document = [
  "# Generated local ten-agent pilot environment. Never commit this file.",
  "HOST=127.0.0.1",
  "PORT=3000",
  "AITERRA_BASE_URL=http://127.0.0.1:3000",
  "EVENT_LOG_PATH=.data/local-pilot-7/world-events.jsonl",
  "WORLD_CONFIG_PATH=config/world.local-5.json",
  "GAME_DAY_REAL_HOURS=4",
  `AGENT_TOKENS_JSON=${JSON.stringify(agentTokens)}`,
  `OWNER_TOKENS_JSON=${JSON.stringify(ownerTokens)}`,
  `OWNER_CHARACTERS_JSON=${JSON.stringify(ownerCharacters)}`,
  `OWNER_FEED_CURSOR_SECRET=${secret(32)}`,
  "OPERATOR_TOKEN=",
  `PILOT_AGENT_IDS=${characterIds.join(",")}`,
  "PILOT_DURATION_MINUTES=30",
  "PILOT_MAX_MODEL_CALLS=10",
  "PILOT_MODEL_CALL_WINDOW_MS=60000",
  "PILOT_POLL_INTERVAL_MS=5000",
  "PILOT_DECISION_COOLDOWN_MS=500",
  "PILOT_LOG_LEVEL=VERBOSE",
  "PILOT_OPEN_AGENT_CONSOLES=true",
  "PILOT_MAIN_CONSOLE_COMBINED=false",
  "PILOT_CONSOLE_AGENT=",
  "PILOT_REPORT_PATH=.data/local-pilot-7/agent-report.json",
  "AZURE_FOUNDRY_ENDPOINT=",
  "AZURE_FOUNDRY_API_KEY=",
  "AZURE_FOUNDRY_MODEL=",
  "AZURE_FOUNDRY_AUTH_MODE=api-key",
  "AZURE_FOUNDRY_API_VERSION=",
  "AZURE_FOUNDRY_MAX_COMPLETION_TOKENS=700",
  "AZURE_FOUNDRY_TEMPERATURE=0.5",
  "AZURE_FOUNDRY_TIMEOUT_MS=60000",
  "AZURE_FOUNDRY_MAXIMUM_ATTEMPTS=3",
  "",
].join("\n");

writeFileSync(outputPath, document, { encoding: "utf8", flag: "wx" });
console.log(`Created ${outputPath}`);
console.log("Add AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_API_KEY locally before running the model smoke test.");

function secret(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function upgradeExistingEnvironment(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const values = new Map(lines
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const existingAgentTokens = parseObject(values.get("AGENT_TOKENS_JSON"), "AGENT_TOKENS_JSON");
  const existingOwnerTokens = parseObject(values.get("OWNER_TOKENS_JSON"), "OWNER_TOKENS_JSON");
  const existingOwnerCharacters = parseObject(values.get("OWNER_CHARACTERS_JSON"), "OWNER_CHARACTERS_JSON");
  for (const id of characterIds) {
    existingAgentTokens[id] ??= secret();
    existingOwnerTokens[`owner-${id}`] ??= secret();
    existingOwnerCharacters[`owner-${id}`] = [id];
  }
  const replacements = new Map([
    ["EVENT_LOG_PATH", ".data/local-pilot-7/world-events.jsonl"],
    ["WORLD_CONFIG_PATH", "config/world.local-5.json"],
    ["AGENT_TOKENS_JSON", JSON.stringify(existingAgentTokens)],
    ["OWNER_TOKENS_JSON", JSON.stringify(existingOwnerTokens)],
    ["OWNER_CHARACTERS_JSON", JSON.stringify(existingOwnerCharacters)],
    ["PILOT_AGENT_IDS", characterIds.join(",")],
    ["PILOT_REPORT_PATH", ".data/local-pilot-7/agent-report.json"],
  ]);
  const seen = new Set();
  const upgraded = lines.map((line) => {
    const separator = line.indexOf("=");
    if (separator < 1 || line.startsWith("#")) return line;
    const key = line.slice(0, separator);
    if (!replacements.has(key)) return line;
    seen.add(key);
    return `${key}=${replacements.get(key)}`;
  });
  for (const [key, value] of replacements) if (!seen.has(key)) upgraded.push(`${key}=${value}`);
  writeFileSync(path, upgraded.join("\n"), "utf8");
  console.log(`Upgraded ${path} for the ten-agent pilot without replacing existing provider credentials.`);
}

function parseObject(value, label) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be an object");
    return parsed;
  } catch (error) {
    throw new Error(`${label} cannot be upgraded: ${error.message}`);
  }
}

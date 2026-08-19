import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AgentSupervisor } from "./agents/agent-supervisor.js";
import { AiterraAgentClient } from "./agents/aiterra-agent-client.js";
import { azureFoundryClientFromEnvironment } from "./agents/azure-foundry-client.js";
import { AgentDecisionPlanner } from "./agents/decision-planner.js";
import { PilotConsoleLogger } from "./agents/pilot-console-logger.js";

const environment = process.env;
const characterIds = (environment.PILOT_AGENT_IDS ?? "pilot-01,pilot-02,pilot-03,pilot-04,pilot-05,pilot-06,pilot-07")
  .split(",").map((value) => value.trim()).filter(Boolean);
if (characterIds.length !== 7 || new Set(characterIds).size !== 7) {
  throw new Error("PILOT_AGENT_IDS must contain exactly seven unique character IDs");
}

const agentTokens = jsonObjectEnvironment(environment, "AGENT_TOKENS_JSON");
const baseUrl = environment.AITERRA_BASE_URL ?? `http://127.0.0.1:${environment.PORT ?? 3000}`;
const modelClient = azureFoundryClientFromEnvironment(environment);
const planner = new AgentDecisionPlanner({ modelClient });
const agents = characterIds.map((characterId) => {
  const token = agentTokens[characterId];
  if (typeof token !== "string" || !token || token === "replace-me") {
    throw new Error(`AGENT_TOKENS_JSON does not contain a usable token for ${characterId}`);
  }
  return {
    characterId,
    client: new AiterraAgentClient({ baseUrl, characterId, token }),
  };
});
const sessionTimestamp = fileTimestamp(new Date());
const activityLogPath = resolve(environment.PILOT_ACTIVITY_LOG_PATH
  ?? `.data/local-pilot-7/agent-activity-${sessionTimestamp}.jsonl`);
const agentLogDirectory = resolve(environment.PILOT_AGENT_LOG_DIRECTORY
  ?? `.data/local-pilot-7/agent-consoles-${sessionTimestamp}`);
const openAgentConsoles = booleanEnvironment(environment, "PILOT_OPEN_AGENT_CONSOLES", true);
const logger = new PilotConsoleLogger({
  level: environment.PILOT_LOG_LEVEL ?? "INFO",
  mode: environment.PILOT_LOG_LEVEL ? null : environment.PILOT_CONSOLE_MODE,
  agentFilter: environment.PILOT_CONSOLE_AGENT,
  agentNames: {
    "pilot-01": "Mira", "pilot-02": "Jonas", "pilot-03": "Nia", "pilot-04": "Elias", "pilot-05": "Sora",
    "pilot-06": "Vera", "pilot-07": "Rook",
  },
  agentIds: characterIds,
  activityLogPath,
  agentLogDirectory,
  openAgentConsoles,
  printAgentActivityToMain: booleanEnvironment(environment, "PILOT_MAIN_CONSOLE_COMBINED", !openAgentConsoles),
});

const supervisor = new AgentSupervisor({
  agents,
  planner,
  concurrency: integerEnvironment(environment, "PILOT_MODEL_CONCURRENCY", 2),
  pollIntervalMs: integerEnvironment(environment, "PILOT_POLL_INTERVAL_MS", 5_000),
  decisionCooldownMs: integerEnvironment(environment, "PILOT_DECISION_COOLDOWN_MS", 500),
  maximumActionsPerCycle: integerEnvironment(environment, "PILOT_MAXIMUM_ACTIONS_PER_CYCLE", 3),
  modelCallsPerWindow: integerEnvironment(environment, "PILOT_MAX_MODEL_CALLS", 10),
  modelCallWindowMs: integerEnvironment(environment, "PILOT_MODEL_CALL_WINDOW_MS", 60_000),
  reconnectDelayMs: integerEnvironment(environment, "PILOT_RECONNECT_DELAY_MS", 2_000),
  // Progressive by default; PILOT_CONTEXT_MODE=full reruns the old baseline for comparison.
  contextMode: environment.PILOT_CONTEXT_MODE === "full" ? "full" : "progressive",
  contextRequestsPerDecision: integerEnvironment(environment, "PILOT_CONTEXT_REQUESTS_PER_DECISION", 1),
  logger,
});

const durationMinutes = numberEnvironment(environment, "PILOT_DURATION_MINUTES", 30);
if (durationMinutes <= 0) throw new Error("PILOT_DURATION_MINUTES must be positive");
const reportPath = resolve(environment.PILOT_REPORT_PATH ?? ".data/local-pilot-7/agent-report.json");
const initialHealth = await readHealth(baseUrl);
let interruptedBy = null;
let resolveStop;
const stopRequested = new Promise((resolveStopRequest) => { resolveStop = resolveStopRequest; });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interruptedBy = signal;
    resolveStop();
  });
}

console.log(`Starting seven-agent pilot against ${baseUrl}`);
console.log(`Model: ${environment.AZURE_FOUNDRY_MODEL}; rate limit: ${environment.PILOT_MAX_MODEL_CALLS ?? 10} calls per agent every ${environment.PILOT_MODEL_CALL_WINDOW_MS ?? 60_000} ms`);
console.log(`The pilot will stop after ${durationMinutes} minutes or on Ctrl+C.`);
console.log(`Live activity: ${environment.PILOT_LOG_LEVEL ?? environment.PILOT_CONSOLE_MODE ?? "INFO"}${environment.PILOT_CONSOLE_AGENT ? ` (main console only: ${environment.PILOT_CONSOLE_AGENT})` : ""}`);
console.log(`Activity log: ${activityLogPath}`);
console.log(`Per-agent logs: ${agentLogDirectory}`);
console.log(`Main terminal agent feed: ${logger.printAgentActivityToMain ? "combined" : "disabled (use the seven separate consoles)"}`);

try {
  await supervisor.start();
  let durationTimer;
  const durationReached = new Promise((resolveTimer) => {
    durationTimer = setTimeout(resolveTimer, durationMinutes * 60_000);
  });
  await Promise.race([
    durationReached,
    stopRequested,
  ]);
  clearTimeout(durationTimer);
} finally {
  await supervisor.stop();
  for (const characterId of characterIds) {
    logger.info(JSON.stringify({
      timestamp: new Date().toISOString(), characterId, event: "pilot_stopped",
      details: { characterName: logger.agentNames.get(characterId) },
    }));
  }
}

const finalHealth = await readHealth(baseUrl);
const metrics = await readMetrics(baseUrl, environment.OPERATOR_TOKEN, initialHealth.worldTime, finalHealth.worldTime);
const report = {
  pilot: {
    characterIds,
    baseUrl,
    model: environment.AZURE_FOUNDRY_MODEL,
    durationMinutes,
    interruptedBy,
    initialWorldTime: initialHealth.worldTime,
    finalWorldTime: finalHealth.worldTime,
    activityLogPath,
    agentLogDirectory,
  },
  supervisor: supervisor.report(),
  metrics,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`Pilot report written to ${reportPath}`);

async function readHealth(url) {
  const response = await fetch(`${url.replace(/\/$/, "")}/health`);
  if (!response.ok) throw new Error(`Aiterra health check failed with HTTP ${response.status}`);
  return response.json();
}

async function readMetrics(url, operatorToken, from, through) {
  const query = new URLSearchParams({ from, through, environment: "local-pilot", isTest: "true", testRunId: "local-seven-agent-pilot" });
  const response = await fetch(`${url.replace(/\/$/, "")}/api/metrics?${query}`, {
    headers: operatorToken ? { Authorization: `Bearer ${operatorToken}` } : {},
  });
  if (!response.ok) return { unavailable: true, httpStatus: response.status };
  return response.json();
}

function jsonObjectEnvironment(environmentObject, name) {
  try {
    const value = JSON.parse(environmentObject[name] ?? "");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object");
    return value;
  } catch (error) {
    throw new Error(`${name} is invalid: ${error.message}`);
  }
}

function integerEnvironment(environmentObject, name, fallback) {
  if (!environmentObject[name]) return fallback;
  const value = Number(environmentObject[name]);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function numberEnvironment(environmentObject, name, fallback) {
  if (!environmentObject[name]) return fallback;
  const value = Number(environmentObject[name]);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function booleanEnvironment(environmentObject, name, fallback) {
  if (!environmentObject[name]) return fallback;
  const value = environmentObject[name].trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be a boolean`);
}

function fileTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

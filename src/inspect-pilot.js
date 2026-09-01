import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node src/inspect-pilot.js .data/<run>");
const read = (name) => existsSync(resolve(directory, name)) ? readFileSync(resolve(directory, name), "utf8") : null;
const json = (name) => { const value = read(name); return value ? JSON.parse(value) : null; };
const lines = (name) => {
  const values = (read(name) ?? "").split("\n");
  return values.flatMap((value, index) => {
    if (!value.trim()) return [];
    try { return [JSON.parse(value)]; }
    catch (error) { if (index === values.length - 1) return []; throw error; }
  });
};
const count = (entries, key) => entries.reduce((result, entry) => {
  const value = key(entry); if (value) result[value] = (result[value] ?? 0) + 1; return result;
}, {});
const report = json("agent-report.json");
const activity = lines("agent-activity.jsonl");
const events = lines("world-events.jsonl").filter((entry) => !report
  || (entry.worldTime >= report.pilot.initialWorldTime && entry.worldTime <= report.pilot.finalWorldTime));
const observations = new Map();
const prompts = new Map();
for (const entry of activity) {
  if (entry.event === "observation_received") observations.set(entry.characterId, { at: entry.timestamp, ...entry.details.observation });
  if (entry.event === "system_prompt") prompts.set(entry.characterId, entry.details.systemPrompt);
}
console.log(JSON.stringify({
  directory, manifest: json("run-manifest.json"), lastActivityAt: activity.at(-1)?.timestamp,
  events: count(events, (entry) => entry.type), activity: count(activity, (entry) => entry.event),
  acceptedActions: count(activity.filter((entry) => entry.event === "action_accepted"), (entry) => entry.details.action.type),
  validationErrors: count(activity.filter((entry) => entry.event === "model_response_invalid"), (entry) => entry.details.validationError),
  rejections: count(activity.filter((entry) => entry.event === "action_rejected"), (entry) => entry.error?.code),
  agents: [...observations].map(([id, observation]) => ({
    id, at: observation.at, name: observation.character?.name, rulesVersion: observation.rulesVersion,
    rulesInPrompt: prompts.get(id)?.includes(observation.rulesVersion) ?? false,
    checkpointInPrompt: prompts.get(id)?.includes("stay_experience") ?? false,
    location: observation.character?.locationId, energy: observation.character?.energy,
    credits: observation.character?.credits, activity: observation.character?.activity,
    availability: observation.character?.agentAvailability, goals: observation.character?.secondaryGoals,
    recentHappiness: observation.recentHappiness, decision: observation.decision,
  })),
  happiness: events.filter((entry) => entry.type === "EXPERIENCE_HAPPINESS_RESOLVED").map((entry) => ({
    characterId: entry.data.characterId, eventId: entry.data.eventId,
    expected: entry.data.expectedHappiness, realized: entry.data.rawDelta,
    error: entry.data.realizedMinusExpected, factors: entry.data.factors,
  })),
  errors: Object.fromEntries(["pilot.stderr.log", "server.stderr.log"].map((name) => [name, read(name)])),
  supervisor: report?.supervisor, metrics: report?.metrics,
}, null, 2));

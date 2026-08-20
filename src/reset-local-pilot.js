import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pilotDataRoot = resolve(repositoryRoot, ".data/local-pilot-7");
const argumentsSet = new Set(process.argv.slice(2));
const dryRun = argumentsSet.has("--dry-run");
const confirmed = argumentsSet.has("--yes");
const baseUrl = process.env.AITERRA_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;

if (await serverIsReachable(baseUrl)) {
  throw new Error(`Aiterra is still running at ${baseUrl}. Stop the agent pilot and server with Ctrl+C before resetting.`);
}

const targets = findResetTargets(pilotDataRoot);
if (targets.length === 0) {
  console.log("The local pilot is already clean.");
  process.exit(0);
}

console.log(`${dryRun ? "Would remove" : "Reset will remove"} ${targets.length} pilot artifact(s):`);
for (const target of targets) console.log(`- ${relative(repositoryRoot, target)}`);
console.log("The .env file, Azure settings, source code, and world configuration will be preserved.");

if (!dryRun && !confirmed) {
  if (!process.stdin.isTTY) throw new Error("Interactive confirmation is unavailable. Re-run with --yes.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question('Type "RESET" to permanently delete this run history: ');
  prompt.close();
  if (answer !== "RESET") {
    console.log("Reset cancelled.");
    process.exit(1);
  }
}

if (dryRun) process.exit(0);
for (const target of targets) {
  assertInsidePilotData(target, pilotDataRoot);
  rmSync(target, { recursive: true, force: true });
}
console.log("Pilot history deleted. The next server start will seed a completely new world from config/world.local-5.json.");

export function findResetTargets(dataRoot) {
  if (!existsSync(dataRoot)) return [];
  return readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.name === "world-events.jsonl"
      || entry.name === "agent-report.json"
      || /^agent-activity-.*\.jsonl$/.test(entry.name)
      || /^agent-consoles-/.test(entry.name)
      || /^pilot-active.*\.json$/.test(entry.name))
    .map((entry) => resolve(dataRoot, entry.name));
}

function assertInsidePilotData(target, dataRoot) {
  const pathFromRoot = relative(dataRoot, resolve(target));
  if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`Unsafe pilot reset target: ${target}`);
  }
}

async function serverIsReachable(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    await fetch(`${url.replace(/\/$/, "")}/health`, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { launchWindowsAgentConsoles } from "./agents/pilot-console-logger.js";

if (process.platform !== "win32") {
  throw new Error("Separate pilot consoles are currently supported only on Windows");
}

const root = resolve(".data/local-pilot-7");
const requestedDirectory = process.argv[2] ?? process.env.PILOT_AGENT_LOG_DIRECTORY;
const agentLogDirectory = requestedDirectory ? resolve(requestedDirectory) : latestAgentLogDirectory(root);
const logFiles = readdirSync(agentLogDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^pilot-[^.]+\.log$/i.test(entry.name))
  .map((entry) => join(agentLogDirectory, entry.name));

if (logFiles.length === 0) throw new Error(`No per-agent logs found in ${agentLogDirectory}`);

const agentLogPaths = new Map();
const agentNames = new Map();
for (const logPath of logFiles) {
  const characterId = basename(logPath, ".log");
  const header = readFileSync(logPath, "utf8").split(/\r?\n/, 1)[0] ?? "";
  const name = header.match(/^Aiterra agent console - (.+) \([^)]+\)$/)?.[1] ?? characterId;
  agentLogPaths.set(characterId, logPath);
  agentNames.set(characterId, name);
}

const launched = launchWindowsAgentConsoles({ agentLogPaths, agentNames });
console.log(`Opened ${launched} separate agent consoles from ${agentLogDirectory}`);

function latestAgentLogDirectory(dataRoot) {
  const directories = readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("agent-consoles-"))
    .map((entry) => ({ path: join(dataRoot, entry.name), modified: statSync(join(dataRoot, entry.name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  if (directories.length === 0) throw new Error(`No pilot agent console directories found in ${dataRoot}`);
  return directories[0].path;
}

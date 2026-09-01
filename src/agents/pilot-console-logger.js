import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOG_LEVELS = Object.freeze({ QUIET: 0, ERROR: 1, WARN: 2, INFO: 3, VERBOSE: 4 });
const LEGACY_MODES = Object.freeze({ quiet: "QUIET", errors: "WARN", activity: "INFO" });

export class PilotConsoleLogger {
  constructor({
    level = "INFO", mode = null, agentFilter = null, agentNames = {}, agentIds = Object.keys(agentNames),
    activityLogPath = null, agentLogDirectory = null, openAgentConsoles = false,
    printAgentActivityToMain = true, output = console, platform = process.platform, spawnImpl = spawn,
  } = {}) {
    this.level = normalizeLogLevel(mode ? LEGACY_MODES[mode] ?? mode : level);
    this.agentFilter = agentFilter?.trim() || null;
    this.agentNames = new Map(Object.entries(agentNames));
    this.agentIds = [...new Set(agentIds)];
    this.activityLogPath = activityLogPath ? resolve(activityLogPath) : null;
    this.agentLogDirectory = agentLogDirectory ? resolve(agentLogDirectory) : null;
    this.agentLogPaths = new Map();
    this.printAgentActivityToMain = printAgentActivityToMain;
    this.output = output;
    if (this.activityLogPath) mkdirSync(dirname(this.activityLogPath), { recursive: true });
    if (this.agentLogDirectory) this.initializeAgentLogs();
    if (openAgentConsoles && this.agentLogDirectory) this.openAgentConsoleWindows(platform, spawnImpl);
  }

  verbose(message) { this.write("verbose", message); }
  info(message) { this.write("info", message); }
  log(message) { this.write("info", message); }
  warn(message) { this.write("warn", message); }
  error(message) { this.write("error", message); }

  write(level, message) {
    const record = parseRecord(level, message);
    if (record.characterId && record.details?.characterName) {
      this.agentNames.set(record.characterId, record.details.characterName);
    }
    if (this.activityLogPath) appendFileSync(this.activityLogPath, `${JSON.stringify(record)}\n`, "utf8");
    const formatted = formatPilotActivity(record, this.agentNames);
    if (record.characterId && this.agentLogPaths.has(record.characterId) && this.includesLevel(record.level)) {
      appendFileSync(this.agentLogPaths.get(record.characterId), `${formatted}\n`, "utf8");
    }
    if (!this.shouldPrint(record)) return;
    const writer = level === "error" ? this.output.error : level === "warn" ? this.output.warn : this.output.log;
    writer.call(this.output, formatted);
  }

  shouldPrint(record) {
    if (!this.includesLevel(record.level)) return false;
    if (!this.printAgentActivityToMain && record.characterId) return false;
    return !this.agentFilter || !record.characterId || record.characterId === this.agentFilter;
  }

  includesLevel(level) {
    return (LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO) <= LOG_LEVELS[this.level];
  }

  initializeAgentLogs() {
    mkdirSync(this.agentLogDirectory, { recursive: true });
    for (const characterId of this.agentIds) {
      const path = join(this.agentLogDirectory, `${characterId}.log`);
      const name = this.agentNames.get(characterId) ?? characterId;
      writeFileSync(path, `Aiterra agent console - ${name} (${characterId})\nLog level: ${this.level}\n\n`, { encoding: "utf8", flag: "wx" });
      this.agentLogPaths.set(characterId, path);
    }
  }

  openAgentConsoleWindows(platform, spawnImpl) {
    if (platform !== "win32") {
      this.output.warn?.("Separate agent consoles are currently supported on Windows; per-agent log files are still available.");
      return;
    }
    launchWindowsAgentConsoles({
      agentLogPaths: this.agentLogPaths,
      agentNames: this.agentNames,
      output: this.output,
      spawnImpl,
    });
  }
}

export function launchWindowsAgentConsoles({
  agentLogPaths,
  agentNames = new Map(),
  output = console,
  spawnImpl = spawn,
  commandShell = process.env.ComSpec ?? "cmd.exe",
  nodeExecutable = process.execPath,
} = {}) {
  const tailScript = resolve(dirname(fileURLToPath(import.meta.url)), "..", "tail-agent-console.js");
  let launched = 0;
  for (const [characterId, logPathValue] of agentLogPaths ?? []) {
    const logPath = resolve(logPathValue);
    const name = agentNames instanceof Map ? agentNames.get(characterId) : agentNames[characterId];
    const title = `Aiterra - ${name ?? characterId} (${characterId})`;
    const launcherPath = join(dirname(logPath), `${basename(logPath, ".log")}.console.cmd`);
    writeFileSync(launcherPath, windowsConsoleLauncher({ nodeExecutable, tailScript, logPath, title }), "utf8");
    try {
      const child = spawnImpl(commandShell, ["/d", "/c", "start", "", launcherPath], {
        detached: true,
        windowsHide: false,
        stdio: "ignore",
      });
      child.on?.("error", (error) => output.warn?.(`Could not open the ${characterId} console: ${error.message}`));
      child.unref?.();
      launched += 1;
    } catch (error) {
      output.warn?.(`Could not open the ${characterId} console: ${error.message}`);
    }
  }
  return launched;
}

function windowsConsoleLauncher({ nodeExecutable, tailScript, logPath, title }) {
  const safeTitle = String(title).replace(/[\r\n&|<>^%]/g, " ").trim();
  const quote = (value) => `"${String(value).replace(/%/g, "%%")}"`;
  return [
    "@echo off",
    `title ${safeTitle}`,
    `${quote(nodeExecutable)} ${quote(tailScript)} ${quote(logPath)} ${quote(safeTitle)}`,
    "",
  ].join("\r\n");
}

export function normalizeLogLevel(value) {
  const normalized = String(value ?? "INFO").trim().toUpperCase();
  if (!(normalized in LOG_LEVELS)) throw new Error("PILOT_LOG_LEVEL must be ERROR, WARN, INFO, VERBOSE, or QUIET");
  return normalized;
}

export function formatPilotActivity(record, agentNames = new Map()) {
  const timestamp = String(record.timestamp ?? new Date().toISOString()).slice(11, 19);
  const characterId = record.characterId ?? "supervisor";
  const name = agentNames instanceof Map ? agentNames.get(characterId) : agentNames[characterId];
  const actor = name && name !== characterId ? `${name}/${characterId}` : characterId;
  const details = record.details ?? {};
  const label = activityLabel(record.event, record.level);
  let description;
  switch (record.event) {
    case "agent_ready":
      description = `protocol ${details.protocolVersion ?? "unknown"}`;
      break;
    case "event_stream_opened":
      description = "live event channel connected";
      break;
    case "observation_received":
      description = formatObservation(details.observation);
      break;
    case "decision_required":
      description = `${details.trigger ?? "unknown"} · ${details.reason ?? "decision required"}`;
      break;
    case "decision_context_requested":
      description = `${details.resource ?? "catalog"} · filters=${JSON.stringify(details.filters ?? {})} · returned=${details.returned ?? "?"}`;
      break;
    case "building_quote_requested":
      description = `${details.proposal?.name ?? "building"} · cost=${details.constructionCost ?? "?"} · upkeep=${details.upkeepPerInterval ?? "?"} · after=${details.creditsAfterConstruction ?? "?"} · ${details.feasibility?.status ?? "unknown"}`;
      break;
    case "model_response_received":
      description = `raw ${truncate(details.content, 2_000)}${formatUsage(details.usage)}`;
      break;
    case "model_response_invalid":
      description = `${details.validationError} · raw ${truncate(details.content, 2_000)}${formatUsage(details.usage)}`;
      break;
    case "model_decision":
      description = `${formatAction(details.action)}${details.rationale ? ` · ${truncate(details.rationale, 500)}` : ""}${formatUsage(details.usage)}`;
      break;
    case "model_decision_failed":
      description = `${record.error?.code ?? record.error?.name ?? "ERROR"} · ${record.error?.message ?? "model decision failed"}`;
      break;
    case "model_rate_limited":
      description = `${details.callsInWindow}/${details.callsPerWindow} calls in window · waiting ${formatMilliseconds(details.waitMs)} then resuming`;
      break;
    case "fallback_action":
      description = formatAction(details.action);
      break;
    case "action_accepted":
      description = `${formatAction(details.action)}${details.decisionRequiredNow ? " · another decision is required" : ""}`;
      break;
    case "action_rejected":
      description = `${formatAction(details.action)} · ${record.error?.code ?? "REJECTED"}: ${record.error?.message ?? "server rejected action"}`;
      break;
    case "action_retry_suppressed":
      description = `${formatAction(details.action)} · unchanged state ${details.stateVersion} · previous ${details.previousErrorCode}`;
      break;
    case "graceful_conversation_closed":
      description = `closed ${details.conversationId} before pilot shutdown`;
      break;
    case "conversation_message_seen": {
      const direction = details.senderId === characterId ? "sent" : `heard from ${details.senderId}`;
      description = `${direction} · ${truncate(details.text, 2_000)}`;
      break;
    }
    case "relevant_event_received":
      description = `${details.requestKind ?? "event"}${details.summary ? ` · ${truncate(details.summary, 500)}` : ""}`;
      break;
    case "notification_acknowledged":
      description = details.notificationEventId ?? "notification";
      break;
    default:
      description = record.error?.message ?? record.event ?? String(record.message ?? "activity");
  }
  return `${timestamp} [${actor}] ${label.padEnd(9)} ${description}`;
}

export function formatAction(action) {
  if (!action || typeof action !== "object") return "unknown action";
  if (action.appraisal) return `${action.type} -> ${action.otherCharacterId}: ${action.appraisal}`;
  const target = action.destinationId ?? action.targetCharacterId ?? action.jobId ?? action.eventId
    ?? action.otherCharacterId ?? action.goalId ?? action.notificationEventId ?? action.conversationId;
  const goal = action.goal ? `${action.goal.type}${action.goal.targetId ? ` -> ${action.goal.targetId}` : ""}` : null;
  const text = action.openingMessage ?? action.text;
  return `${action.type}${goal ? ` ${goal}` : target ? ` -> ${target}` : ""}${text ? ` · "${truncate(text, 2_000)}"` : ""}`;
}

function formatObservation(observation) {
  if (!observation) return "empty observation";
  const character = observation.character ?? {};
  const nearby = (observation.nearby ?? []).map((item) => item.name ?? item.id).join(", ") || "none";
  const actions = (observation.availableActions ?? []).map((item) => item.type).join(", ") || "none";
  const activity = character.activity?.type ?? "idle";
  return `location=${character.locationId ?? "unknown"} · energy=${character.energy ?? "?"} · activity=${activity} · nearby=${nearby} · pending=${observation.pendingNotifications?.length ?? 0} · actions=${actions}`;
}

function parseRecord(level, message) {
  if (typeof message === "string") {
    try {
      const parsed = JSON.parse(message);
      if (parsed && typeof parsed === "object") return { level, ...parsed };
    } catch {
      return { timestamp: new Date().toISOString(), level, characterId: null, event: "log", message };
    }
  }
  if (message && typeof message === "object") return { timestamp: new Date().toISOString(), level, ...message };
  return { timestamp: new Date().toISOString(), level, characterId: null, event: "log", message: String(message) };
}

function activityLabel(event, level) {
  const labels = {
    agent_ready: "READY",
    event_stream_opened: "STREAM",
    observation_received: "STATE",
    decision_required: "THINK",
    decision_context_requested: "INSPECT",
    building_quote_requested: "QUOTE",
    model_response_received: "MODEL RAW",
    model_response_invalid: "INVALID",
    model_decision: "DECIDE",
    model_decision_failed: "REJECT",
    model_rate_limited: "RATE WAIT",
    fallback_action: "FALLBACK",
    action_accepted: "ACT",
    action_rejected: "REJECT",
    action_retry_suppressed: "SKIP",
    graceful_conversation_closed: "CLOSE",
    conversation_message_seen: "MESSAGE",
    relevant_event_received: "EVENT",
    notification_acknowledged: "ACK",
  };
  return labels[event] ?? level.toUpperCase();
}

function formatUsage(usage) {
  const total = Number(usage?.total_tokens ?? usage?.totalTokens ?? 0);
  return Number.isFinite(total) && total > 0 ? ` · ${total} tokens` : "";
}

function formatMilliseconds(milliseconds) {
  const seconds = Number(milliseconds ?? 0) / 1_000;
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

function truncate(value, maximum) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

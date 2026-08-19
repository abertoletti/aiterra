import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatAction, formatPilotActivity, normalizeLogLevel, PilotConsoleLogger } from "../src/agents/pilot-console-logger.js";

test("pilot activity formatting identifies the character, decision, message, rationale, and usage", () => {
  const line = formatPilotActivity({
    timestamp: "2026-08-18T18:42:11.000Z",
    level: "info",
    characterId: "pilot-01",
    event: "model_decision",
    details: {
      action: { type: "start_conversation", targetCharacterId: "pilot-02", openingMessage: "Hello Jonas" },
      rationale: "Jonas is nearby and Mira wants to meet the community.",
      usage: { total_tokens: 842 },
    },
  }, new Map([["pilot-01", "Mira"]]));

  assert.match(line, /\[Mira\/pilot-01\]/);
  assert.match(line, /DECIDE/);
  assert.match(line, /start_conversation -> pilot-02/);
  assert.match(line, /Hello Jonas/);
  assert.match(line, /842 tokens/);
});

test("pilot console can filter the live feed to one agent", () => {
  const output = [];
  const sink = { log: (line) => output.push(line), warn: (line) => output.push(line), error: (line) => output.push(line) };
  const logger = new PilotConsoleLogger({ mode: "activity", agentFilter: "pilot-02", output: sink });
  logger.info(JSON.stringify({ characterId: "pilot-01", event: "event_stream_opened" }));
  logger.info(JSON.stringify({ characterId: "pilot-02", event: "event_stream_opened" }));
  assert.equal(output.length, 1);
  assert.match(output[0], /pilot-02/);
});

test("action formatting exposes social and goal targets", () => {
  assert.equal(formatAction({ type: "appraise_interaction", otherCharacterId: "pilot-02", appraisal: "appreciated" }),
    "appraise_interaction -> pilot-02: appreciated");
  assert.equal(formatAction({ type: "propose_secondary_goal", goal: { type: "visit_location", targetId: "archive" } }),
    "propose_secondary_goal visit_location -> archive");
});

test("verbose is the most detailed configurable pilot log level", () => {
  assert.equal(normalizeLogLevel("verbose"), "VERBOSE");
  assert.throws(() => normalizeLogLevel("debug"), /PILOT_LOG_LEVEL/);
  const output = [];
  const sink = { log: (line) => output.push(line), warn: (line) => output.push(line), error: (line) => output.push(line) };
  const info = new PilotConsoleLogger({ level: "INFO", output: sink });
  info.verbose(JSON.stringify({ characterId: "pilot-01", event: "observation_received", details: { observation: {} } }));
  info.info(JSON.stringify({ characterId: "pilot-01", event: "decision_required" }));
  assert.equal(output.length, 1);
});

test("conversation messages are printed without hiding their text", () => {
  const line = formatPilotActivity({
    timestamp: "2026-08-18T18:42:11.000Z", level: "info", characterId: "pilot-02",
    event: "conversation_message_seen",
    details: { senderId: "pilot-01", text: "What should we build together today?" },
  });
  assert.match(line, /heard from pilot-01/);
  assert.match(line, /What should we build together today\?/);
});

test("Windows pilot startup creates and opens one isolated log console per agent", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "aiterra-agent-consoles-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const spawns = [];
  const spawnImpl = (...parameters) => {
    spawns.push(parameters);
    return { on() {}, unref() {} };
  };
  const logger = new PilotConsoleLogger({
    level: "VERBOSE",
    agentIds: ["pilot-01", "pilot-02"],
    agentNames: { "pilot-01": "Mira", "pilot-02": "Jonas" },
    agentLogDirectory: directory,
    openAgentConsoles: true,
    platform: "win32",
    spawnImpl,
    output: { log() {}, warn() {}, error() {} },
  });
  logger.info(JSON.stringify({ characterId: "pilot-01", event: "conversation_message_seen", details: { senderId: "pilot-02", text: "Hello Mira" } }));

  assert.equal(spawns.length, 2);
  assert.match(spawns[0][0], /cmd\.exe$/i);
  assert.deepEqual(spawns[0][1].slice(0, 4), ["/d", "/c", "start", ""]);
  assert.equal(spawns[0][2].detached, true);
  assert.equal(spawns[0][2].windowsHide, false);
  assert.equal(existsSync(join(directory, "pilot-01.console.cmd")), true);
  assert.match(readFileSync(join(directory, "pilot-01.console.cmd"), "utf8"), /tail-agent-console\.js/);
  assert.match(readFileSync(join(directory, "pilot-01.log"), "utf8"), /Hello Mira/);
  assert.doesNotMatch(readFileSync(join(directory, "pilot-02.log"), "utf8"), /Hello Mira/);
});

test("main terminal can stay quiet while isolated agent consoles receive activity", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "aiterra-agent-main-quiet-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = [];
  const logger = new PilotConsoleLogger({
    agentIds: ["pilot-01"],
    agentLogDirectory: directory,
    printAgentActivityToMain: false,
    output: { log: (line) => output.push(line), warn: (line) => output.push(line), error: (line) => output.push(line) },
  });
  logger.info(JSON.stringify({ characterId: "pilot-01", event: "event_stream_opened" }));

  assert.equal(output.length, 0);
  assert.match(readFileSync(join(directory, "pilot-01.log"), "utf8"), /STREAM/);
});

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { loadWorldConfiguration } from "./config/world-configuration.js";

// Own both children, never attach to or kill a server found by port/PID alone.
// A new directory and a frozen config keep a paid run separate from prior evidence.
export async function runManagedPilot({ runDirectory, durationMinutes = 30, environment = process.env }) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const dataRoot = resolve(root, ".data");
  const directory = resolve(root, runDirectory);
  const scope = relative(dataRoot, directory);
  if (!scope || scope.startsWith("..") || isAbsolute(scope)) throw new Error("Run directory must be a new child of .data");
  if (existsSync(directory)) throw new Error("Run directory already exists; never reuse a pilot log");
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 30) throw new Error("Pilot duration must be greater than zero and at most 30 minutes");
  const configuration = loadWorldConfiguration(resolve(root, environment.WORLD_CONFIG_PATH ?? "config/world.local-5.json"));
  if (configuration.events.length !== 0) throw new Error("This managed pilot requires no initial events");
  const baseUrl = `http://127.0.0.1:${environment.PORT ?? 3000}`;
  // Refuse to run agents against an unrelated listener, even if our child cannot bind.
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
    throw new Error("A server is already listening; stop it explicitly before starting a managed pilot");
  } catch (error) {
    if (error.cause?.code !== "ECONNREFUSED") throw error;
  }
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(directory);
  const snapshot = resolve(directory, "world-config.json");
  writeFileSync(snapshot, JSON.stringify(configuration, null, 2) + "\n");
  const env = {
    ...environment, HOST: "127.0.0.1", AITERRA_BASE_URL: baseUrl,
    WORLD_CONFIG_PATH: snapshot, EVENT_LOG_PATH: resolve(directory, "world-events.jsonl"),
    PILOT_ACTIVITY_LOG_PATH: resolve(directory, "agent-activity.jsonl"),
    PILOT_AGENT_LOG_DIRECTORY: resolve(directory, "agent-consoles"),
    PILOT_REPORT_PATH: resolve(directory, "agent-report.json"),
    PILOT_DURATION_MINUTES: String(durationMinutes), PILOT_OPEN_AGENT_CONSOLES: "false",
    PILOT_AGENT_IDS: configuration.characters.map((character) => character.id).join(","),
  };
  const manifest = { runDirectory: directory, configVersion: configuration.version, baseUrl,
    durationMinutes, startedAt: new Date().toISOString(), status: "starting", children: {} };
  const save = () => writeFileSync(resolve(directory, "run-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const launch = (name, script) => {
    const output = openSync(resolve(directory, `${name}.stdout.log`), "wx");
    const errors = openSync(resolve(directory, `${name}.stderr.log`), "wx");
    let child;
    try { child = spawn(process.execPath, [script], { cwd: root, env, windowsHide: true, stdio: ["ignore", output, errors] }); }
    finally { closeSync(output); closeSync(errors); }
    manifest.children[name] = { pid: child.pid, command: [process.execPath, script], startedAt: new Date().toISOString() };
    child.finished = new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => {
        Object.assign(manifest.children[name], { code, signal, stoppedAt: new Date().toISOString() }); save();
        resolveExit({ code, signal });
      });
    });
    // Ensure startup failure is observed even before the race below is installed.
    child.finished.catch(() => {});
    save();
    return child;
  };
  const stopOwned = async (child) => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    let timer;
    try {
      await Promise.race([child.finished, new Promise((resolveKill) => {
        timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); resolveKill(); }, 5_000);
      })]);
      await child.finished;
    } finally { clearTimeout(timer); }
  };
  let server, runner, watchdog;
  let rejectInterrupted;
  const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
  interrupted.catch(() => {});
  const onSignal = () => rejectInterrupted(new Error("Managed pilot interrupted"));
  process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
  try {
    server = launch("server", "src/index.js");
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null || server.signalCode !== null) throw new Error("Pilot server exited during startup");
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
        if (response.ok && existsSync(env.EVENT_LOG_PATH)) { ready = true; break; }
      } catch { /* bounded startup polling */ }
      await Promise.race([delay(250), interrupted]);
    }
    if (!ready) throw new Error("Pilot server did not become ready");
    runner = launch("pilot", "src/run-5-agent-pilot.js");
    manifest.status = "running"; save();
    console.log(JSON.stringify(manifest));
    const result = await Promise.race([
      runner.finished,
      server.finished.then(() => { throw new Error("Pilot server exited before runner completion"); }),
      interrupted,
      new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("Pilot shutdown exceeded duration plus two-minute grace")), (durationMinutes + 2) * 60_000); }),
    ]);
    if (result.code !== 0) throw new Error(`Pilot runner failed: ${JSON.stringify(result)}`);
    if (!existsSync(env.PILOT_REPORT_PATH)) throw new Error("Pilot runner exited without its report");
    JSON.parse(readFileSync(env.PILOT_REPORT_PATH, "utf8"));
    manifest.status = "completed";
  } catch (error) {
    manifest.status = "failed"; manifest.error = error.message;
    throw error;
  } finally {
    clearTimeout(watchdog);
    try { await stopOwned(runner); }
    finally {
      try { await stopOwned(server); }
      finally {
        manifest.stoppedAt = new Date().toISOString(); save();
        process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
      }
    }
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runDirectory = process.argv[2];
  if (!runDirectory) throw new Error("Usage: node --env-file=.env src/run-managed-pilot.js .data/<new-run> [minutes]");
  await runManagedPilot({ runDirectory, durationMinutes: Number(process.argv[3] ?? 30) });
}

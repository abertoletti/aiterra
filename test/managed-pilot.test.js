import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runManagedPilot } from "../src/run-managed-pilot.js";

test("managed pilots refuse broad/reused paths and invalid duration before starting children", async () => {
  for (const runDirectory of [".data", "..", "config"]) {
    await assert.rejects(runManagedPilot({ runDirectory }), /new child/);
  }
  await assert.rejects(runManagedPilot({ runDirectory: ".data", durationMinutes: 31 }), /new child/);
  await assert.rejects(runManagedPilot({ runDirectory: `.data/test-${randomUUID()}`, durationMinutes: 121 }), /at most 120/);
});

test("a failed runner leaves evidence and its owned server is stopped without any model calls", { timeout: 20_000 }, async () => {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, "127.0.0.1", done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  const runDirectory = `.data/test-managed-${randomUUID()}`;
  // No credentials or endpoint: the runner fails in configuration, before inference.
  await assert.rejects(runManagedPilot({ runDirectory, durationMinutes: 0.01,
    environment: { PORT: String(port), GAME_DAY_REAL_HOURS: "2" } }), /runner failed/);
  const manifest = JSON.parse(readFileSync(resolve(runDirectory, "run-manifest.json"), "utf8"));
  assert.equal(manifest.status, "failed");
  assert.ok(manifest.children.server.stoppedAt);
  assert.ok(manifest.children.pilot.stoppedAt);
  assert.throws(() => process.kill(manifest.children.server.pid, 0), /ESRCH/);
  assert.ok(readFileSync(resolve(runDirectory, "pilot.stderr.log"), "utf8").length > 0);
  const config = JSON.parse(readFileSync(resolve(runDirectory, "world-config.json"), "utf8"));
  assert.deepEqual(config.events, []);
  await assert.rejects(runManagedPilot({ runDirectory }), /already exists/);
});

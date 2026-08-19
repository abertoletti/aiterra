import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { World } from "../src/domain/world.js";
import { JsonlEventStore } from "../src/infra/event-store.js";

test("a file-backed restart recovers overdue deadlines once in causal order and reports delay", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "aiterra-recovery-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, "world-events.jsonl");
  const config = makeConfig();
  const beforeRestartClock = new ManualClock("2042-01-01T10:00:00.000Z");
  const store = new JsonlEventStore(filePath);
  let id = 1;
  const first = new World({ store, config, clock: beforeRestartClock, idGenerator: () => `persist-${id++}` });
  first.defineLocation({ id: "work", name: "Work" });
  first.createCharacter({ id: "funder", name: "Funder", locationId: "work", credits: 200 });
  first.createCharacter({ id: "worker", name: "Worker", locationId: "work" });
  first.createJob({
    creatorId: "funder", id: "shift", title: "Shift", locationId: "work",
    durationGameMinutes: 30, compensation: 100,
  });
  first.acceptJob("worker", "shift");
  first.startJob("worker", "shift");
  const conversation = first.startConversation("funder", "worker", "Can you answer while working?");
  const notification = first.getPendingNotificationEvents("worker")[0];
  first.markNotificationDelivered("worker", notification.id, new Date("2026-08-18T10:00:00.000Z"));

  const recoveredClock = new ManualClock("2042-01-01T11:00:00.000Z");
  const recovered = new World({ store: new JsonlEventStore(filePath), config, clock: recoveredClock, idGenerator: () => `recover-${id++}` });
  recovered.advanceTo(recoveredClock.now(), new Date("2026-08-18T11:00:00.000Z"));
  recovered.advanceTo(recoveredClock.now(), new Date("2026-08-18T11:00:00.000Z"));

  assert.equal(recovered.getNotificationEnvelope(notification.id).status, "expired");
  assert.equal(recovered.getPublicState().jobs.find((job) => job.id === "shift").status, "completed");
  assert.equal(recovered.getObservation("worker").character.credits, 100);
  assert.equal(recovered.history.filter((event) => event.type === "JOB_COMPLETED").length, 1);
  assert.equal(recovered.history.filter((event) => event.type === "CONVERSATION_TURN_EXPIRED"
    && event.data.conversationId === conversation.data.conversationId).length, 1);
  const expiry = recovered.history.find((event) => event.type === "AGENT_NOTIFICATION_EXPIRED");
  const completion = recovered.history.find((event) => event.type === "JOB_COMPLETED");
  assert.ok(expiry.sequence < completion.sequence, "the earlier response deadline is recovered before later work completion");
  assert.ok(expiry.data.processingDelayWorldMilliseconds > 0);
  assert.ok(completion.data.processingDelayWorldMilliseconds > 0);
  assert.ok(recovered.getProductMetrics().operations.deadlineProcessingDelay.maximumWorldMilliseconds > 0);

  const replayedAgain = new World({
    store: new JsonlEventStore(filePath), config, clock: recoveredClock,
    idGenerator: () => `replay-${id++}`,
  });
  replayedAgain.advanceTo(recoveredClock.now(), new Date("2026-08-18T11:00:00.000Z"));
  assert.equal(replayedAgain.getObservation("worker").character.credits, 100);
  assert.equal(replayedAgain.history.filter((event) => event.type === "JOB_COMPLETED").length, 1);
});

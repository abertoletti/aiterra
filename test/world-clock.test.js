import assert from "node:assert/strict";
import test from "node:test";
import { AcceleratedWorldClock } from "../src/domain/clock.js";

// World time is a formula over the wall clock. The optional anchor exists for resumed
// pilots: it pins one real instant to one world instant so downtime reads as a pause,
// while everything else - the factor, deadline conversion, monotonicity - stays the rule
// every process already agrees on.

const clockConfig = {
  realEpoch: "2026-01-01T00:00:00.000Z",
  gameEpoch: "2042-01-01T00:00:00.000Z",
  realHoursPerGameDay: 2,
};

test("an anchored clock resumes exactly where the log stopped and moves at the same factor", () => {
  const lastEventWorldTime = "2049-08-12T19:20:53.244Z";
  const bootRealTime = new Date("2026-08-21T09:00:00.000Z");
  const clock = new AcceleratedWorldClock(clockConfig, {
    worldTime: lastEventWorldTime, realTime: bootRealTime,
  });

  assert.equal(clock.atRealTime(bootRealTime).toISOString(), lastEventWorldTime,
    "at boot, world time is the log's last recorded moment");

  const oneRealHourLater = clock.atRealTime(new Date(bootRealTime.getTime() + 3_600_000));
  assert.equal((oneRealHourLater - clock.atRealTime(bootRealTime)) / 3_600_000, 12,
    "one real hour is still twelve world hours at 2 real hours per world day");
  assert.ok(oneRealHourLater > new Date(lastEventWorldTime),
    "time only moves forward from the anchor, so the log stays ordered");

  // Deadline conversion is factor-only, so a resumed world gives brains the same
  // thinking time as a fresh one.
  assert.equal(clock.realMillisecondsForGameMinutes(12), 60_000);
});

test("without an anchor the clock is the pure formula, which is the unchanged contract", () => {
  const plain = new AcceleratedWorldClock(clockConfig);
  const at = new Date("2026-08-21T09:00:00.000Z");
  const anchored = new AcceleratedWorldClock(clockConfig, {
    worldTime: "2049-08-12T19:20:53.244Z", realTime: at,
  });
  assert.notEqual(plain.atRealTime(at).getTime(), anchored.atRealTime(at).getTime(),
    "the anchor is opt-in; the default mapping does not move");
  assert.throws(() => new AcceleratedWorldClock(clockConfig, { worldTime: "not-a-time" }),
    /Invalid anchor world time/);
});

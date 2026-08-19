export class AcceleratedWorldClock {
  constructor(config) {
    this.realEpochMs = Date.parse(config.realEpoch);
    this.gameEpochMs = Date.parse(config.gameEpoch);
    this.factor = 24 / Number(config.realHoursPerGameDay);
    if (!Number.isFinite(this.factor) || this.factor <= 0) {
      throw new Error("realHoursPerGameDay must be a positive number");
    }
  }

  now() {
    return this.atRealTime(new Date());
  }

  atRealTime(realDate) {
    const elapsedRealMs = realDate.getTime() - this.realEpochMs;
    return new Date(this.gameEpochMs + elapsedRealMs * this.factor);
  }

  realMillisecondsForGameMinutes(gameMinutes) {
    return Number(gameMinutes) * 60_000 / this.factor;
  }
}

export class ManualClock {
  constructor(initialTime) {
    this.current = new Date(initialTime);
    if (Number.isNaN(this.current.getTime())) throw new Error("Invalid initial world time");
  }

  now() {
    return new Date(this.current);
  }

  set(time) {
    const next = new Date(time);
    if (Number.isNaN(next.getTime())) throw new Error("Invalid world time");
    if (next < this.current) throw new Error("World time cannot move backwards");
    this.current = next;
    return this.now();
  }

  advanceGameMinutes(minutes) {
    return this.set(addGameMinutes(this.current, minutes));
  }

  realMillisecondsForGameMinutes(gameMinutes) {
    // Manual clocks are normally used by deterministic tests. Match the
    // default 6x world acceleration unless the caller supplies real time.
    return Number(gameMinutes) * 60_000 / 6;
  }
}

export function addGameMinutes(time, minutes) {
  return new Date(new Date(time).getTime() + Number(minutes) * 60_000);
}

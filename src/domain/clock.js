export class AcceleratedWorldClock {
  // World time is a formula over the wall clock, never a stored counter: nothing to
  // corrupt, nothing that can rewind, and every process agrees by reading the same rule.
  //
  // The optional anchor pins "this real instant IS that world instant" and keeps the same
  // factor from there. It exists for resumed pilots: without it, a restarted world bills
  // its residents for every hour the server was down - upkeep charged, happiness decayed,
  // deadlines lapsed - because the formula kept moving while nobody lived. Anchoring to
  // the log's last event makes downtime a pause instead of a famine. It also absorbs a
  // factor change between runs, which would otherwise teleport world time.
  constructor(config, anchor = null) {
    this.realEpochMs = Date.parse(config.realEpoch);
    this.gameEpochMs = Date.parse(config.gameEpoch);
    this.factor = 24 / Number(config.realHoursPerGameDay);
    if (!Number.isFinite(this.factor) || this.factor <= 0) {
      throw new Error("realHoursPerGameDay must be a positive number");
    }
    this.offsetMs = 0;
    if (anchor) {
      const anchorWorldMs = Date.parse(anchor.worldTime);
      if (Number.isNaN(anchorWorldMs)) throw new Error("Invalid anchor world time");
      const anchorRealMs = anchor.realTime ? new Date(anchor.realTime).getTime() : Date.now();
      if (Number.isNaN(anchorRealMs)) throw new Error("Invalid anchor real time");
      this.offsetMs = anchorWorldMs - (this.gameEpochMs + (anchorRealMs - this.realEpochMs) * this.factor);
    }
  }

  now() {
    return this.atRealTime(new Date());
  }

  atRealTime(realDate) {
    const elapsedRealMs = realDate.getTime() - this.realEpochMs;
    return new Date(this.gameEpochMs + elapsedRealMs * this.factor + this.offsetMs);
  }

  realMillisecondsForGameMinutes(gameMinutes) {
    return Number(gameMinutes) * 60_000 / this.factor;
  }

  gameMinutesForRealMilliseconds(realMilliseconds) {
    return Number(realMilliseconds) * this.factor / 60_000;
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

  gameMinutesForRealMilliseconds(realMilliseconds) {
    return Number(realMilliseconds) * 6 / 60_000;
  }
}

export function addGameMinutes(time, minutes) {
  return new Date(new Date(time).getTime() + Number(minutes) * 60_000);
}

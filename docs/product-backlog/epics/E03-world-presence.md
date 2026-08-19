# E03 — Persistent world, time, and presence

**Status:** Done

## Objective

Provide a world that continues to progress, where activities and travel unfold over time and presence in the same location makes encounters possible.

## Expected outcome

The character does not own a `time` resource: activities, events, and travel have instants and durations that prevent incompatible actions.

## Stories

### AIT-301 — Use continuous and configurable world time

**Type:** Technical enabler · **Priority:** P0 · **Increment:** A · **Status:** Done

**Specification:** Updated (2026-08-18)

The world must maintain continuous, persistent, and accelerable time so that every action shares the same timeline.

**Acceptance criteria**

- The ratio is configurable; the local pilot baseline represents one game day in four real hours.
- APIs expose the world instant unambiguously.
- A restart does not move time backward or lose deadlines.
- No character has a spendable attribute named `time`.
- Tests can use a controllable clock without waiting for real time.

**Technical metrics:** deadline-processing delay, missed deadlines.

### AIT-302 — Travel between locations

**Priority:** P0 · **Increment:** A · **Status:** Done

As an external agent, I want to propose travel to a reachable location so that the character can be where opportunities and encounters may arise.

**Acceptance criteria**

- The observation shows only known and reachable destinations.
- The server determines duration, any cost, and arrival time.
- During travel, the character is not present at both origin and destination.
- On arrival, presence changes exactly once even after retries.
- Travel that conflicts with the current activity is rejected with a stable reason.

**Events and metrics:** `travel_started`, `travel_completed`, `travel_rejected`.

**Dependencies:** AIT-301, AIT-402.

### AIT-303 — Prevent temporally incompatible activities

**Priority:** P0 · **Increment:** A · **Status:** Done

As an external agent, I want to know whether the character is busy and which reactions are compatible so that I can propose realistic actions.

**Acceptance criteria**

- The server prevents two overlapping, incompatible primary activities.
- An activity can declare compatible secondary reactions, such as greeting someone during a work shift.
- The observation distinguishes the primary activity, available reactions, and expected end time.
- Completing an activity frees the character exactly once.

**Events and metrics:** `action_conflict_rejected`, reactions during activities.

**Dependencies:** AIT-301, AIT-401.

### AIT-304 — Recover deadlines after an interruption

**Type:** Technical enabler · **Priority:** P1 · **Increment:** A · **Status:** Done

The world must correctly complete or recover actions and events that became due during downtime so that simulation continuity is preserved.

**Acceptance criteria**

- Unprocessed deadlines are detected after a restart.
- Every consequence is applied at most once.
- Causal order is preserved when multiple deadlines affect the same characters.
- Processing delay remains visible in operational metrics.

**Dependencies:** AIT-301, AIT-403.

## Out of scope

- continuous movement on a graphical map;
- meter-level physical distances;
- detailed traffic simulation.

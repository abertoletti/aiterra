# E06 — Unexpected events and wake-ups

**Status:** Done

## Objective

Interrupt routine when something relevant happens, allowing agents to react and generate new narrative chains without continuous polling.

## Expected outcome

A world event is evaluated in the character's context, delivered to the external brain, and handled even when that brain does not respond.

## Stories

### AIT-601 — Generate world events not requested by the agent

**Priority:** P0 · **Increment:** B · **Status:** Done

As an operator, I want to configure events that happen independently of an individual agent's decisions so that I can introduce variation and social opportunities.

**Acceptance criteria**

- An event has a type, location, instant, visibility, and authorized mechanical consequences.
- It can be scheduled or triggered by an actual world change, such as an arrival.
- Affected participants are determined by the server.
- Generation is reproducible in tests through a seed or controlled trigger.
- The event does not force a character into a specific narrative choice.

**Events and metrics:** `world_event_created`, characters exposed per event.

**Dependencies:** AIT-301, AIT-1001.

### AIT-602 — Evaluate relevance to the character

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to be woken only for plausibly relevant events so that I can react to important opportunities without wasting inference.

**Acceptance criteria**

- Perceptibility is a hard gate: an imperceptible event never becomes relevant because of a relationship or goal.
- Relevance considers presence, activity, known relationship, direct involvement, configured event importance, and structured primary or secondary goal matches according to the [goals and relevance policy](../rules/goals-and-relevance-policy.md).
- The calculation is deterministic for identical state and configuration.
- Only the highest matching goal contributes; goal stacking cannot manufacture relevance.
- Relevance and urgency are distinct: goals can cause a wake-up but cannot promote an ordinary event to `CRITICAL`.
- The operator can configure the threshold within product limits.
- The score, factor breakdown, selected goal, threshold, and rule version are persisted for diagnosis.

**Events and metrics:** evaluated events, relevant events, reported false positives.

**Dependencies:** AIT-104, AIT-601, AIT-501, AIT-701.

### AIT-603 — Wake the external brain for a relevant event

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to receive a relevant event promptly with the necessary context so that I can decide whether to interrupt, react, or ignore it.

**Acceptance criteria**

- Delivery identifies the event, character, compatible reactions, timing-policy version, and fixed real-time and world-time deadlines.
- Delivery is authenticated and does not contain secrets shared in credentials.
- Delivery retries do not create new event instances.
- Delivery state distinguishes queued, delivered, acknowledged, and failed attempts so that an acknowledged non-response can be distinguished from an unreachable runtime.
- The agent can explicitly ignore the event; the server resolves the corresponding authoritative `no_action` outcome immediately, including any missed opportunity or obligation.
- The proposed reaction is still validated by the server.

**Events and metrics:** `agent_wakeup_sent`, `agent_wakeup_delivered`, `agent_wakeup_acknowledged`, `agent_wakeup_delivery_failed`, `event_reacted`, reaction latency.

**Dependencies:** AIT-602, AIT-402.

### AIT-604 — Continue when the brain does not respond

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an owner, I want the world not to become blocked when my agent is offline so that the character retains a persistent life with understandable consequences.

**Acceptance criteria**

- Every reaction request has fixed real-time and world-time deadlines according to the versioned [interaction timing and silence policy](../rules/interaction-timing-policy.md).
- At the deadline, the server resolves `no_action` or `remain_silent` as an explicit outcome; it is not mechanically neutral when an opportunity, duty, commitment, or person was waiting for a response.
- The fallback does not use Aiterra-funded LLM inference to impersonate the character.
- World deadlines, missed opportunities, work failures, and bounded social consequences continue according to their authoritative rules, so intentionally skipping a response cannot erase an unfavorable situation.
- Repeated missed expected responses mark the external runtime as `AGENT_UNAVAILABLE` and prevent it from starting new synchronous commitments until recovery is verified.
- A confirmed Aiterra platform incident suspends or extends affected deadlines and produces no character penalty.
- On return, the agent and owner can see the missed event and applied fallback.

**Events and metrics:** `agent_reaction_timed_out`, `silence_resolved`, `agent_marked_unavailable`, `deadline_suppressed_for_platform_incident`, agent availability, missed events.

**Dependencies:** AIT-603, AIT-801.

## Out of scope

- a server-side LLM plot generator;
- large-scale global events;
- guaranteed instant delivery to powered-off user computers.

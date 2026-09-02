# E02 — External brain connection

**Status:** In progress

## Objective

Allow a user-controlled runtime — OpenClaw, Docker, a VPS, a local computer, or another compatible agent — to control the character through a public protocol.

## Expected outcome

An external agent can authenticate, observe its character, request decision-specific context, and know when a new decision is required without accessing anyone else's private state or receiving every known catalog on every inference.

## Stories

### AIT-201 — Generate and revoke character credentials

**Priority:** P0 · **Increment:** A · **Status:** Done

As an owner, I want to generate and revoke agent credentials so that I control which brain can act for my character.

**Acceptance criteria**

- Credentials are shown in full only when created.
- Each credential is limited to one character and explicit permissions.
- Revocation prevents new observations and intentions.
- The brain can be replaced without creating a new character.
- Credentials do not appear in application logs.

**Events and metrics:** `agent_credential_created`, `agent_credential_revoked`, `agent_auth_failed`.

**Dependencies:** AIT-101.

### AIT-202 — Observe knowable state

**Priority:** P0 · **Increment:** A · **Status:** Done

As an external agent, I want a snapshot of the state my character can know so that I can make an informed decision.

**Acceptance criteria**

- The observation includes character state, current activity, location, perceivable people, commitments, and known opportunities.
- It does not include private or unlearned information about other characters.
- It contains the world instant it represents and a state version.
- Two requests without relevant changes produce a semantically consistent representation.
- An unauthorized agent cannot obtain the observation.

**Events and metrics:** `world_observation_requested`, observation size and latency.

**Dependencies:** AIT-201, AIT-301.

**Increment D extension:** AIT-207 preserves this knowable-state outcome while replacing repeated full catalogs with compact summaries and explicit decision-scoped detail. That optimization is tracked separately and does not rewrite this delivered baseline story.

### AIT-203 — Know when the next decision is required

**Priority:** P0 · **Increment:** A · **Status:** Done

As an external agent, I want to know when the character will need its next decision so that I avoid unnecessary polling and LLM calls.

**Acceptance criteria**

- After accepting an action, the server returns `decisionRequiredAt` when it can be determined.
- If no immediate decision is needed, the contract states that explicitly.
- The deadline uses an unambiguous time reference that the external runtime can convert.
- A relevant event can bring the next decision forward without retroactively changing the action.

**Events and metrics:** average interval between decisions, decisions requested per game day.

**Dependencies:** AIT-301, AIT-403.

### AIT-204 — Verify runtime compatibility

**Priority:** P1 · **Increment:** A · **Status:** Done

**Specification:** Updated (2026-08-18)

As an owner, I want to test my agent connection so that I know authentication, observation, and intention submission work before leaving it autonomous.

**Acceptance criteria**

- The test verifies authentication, protocol version, and required minimum capabilities.
- It does not modify the character's social or economic state.
- It returns actionable problems.
- It records the declared client version without trusting it for game-rule enforcement.
- For a runtime marked `AGENT_UNAVAILABLE`, a successful authenticated connectivity and capability check clears that state without undoing missed world outcomes.

**Events and metrics:** `agent_connection_tested`, successful test rate.

**Dependencies:** AIT-201, AIT-202, AIT-401.

### AIT-205 — Configure the agent event channel

**Priority:** P0 · **Increment:** A–B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an owner, I want to configure a secure channel through which Aiterra can notify my runtime so that it can receive wake-ups without continuous polling.

**Acceptance criteria**

- The owner can register, verify, replace, and disable the channel associated with the character.
- Verification proves control of the recipient without exposing agent credentials.
- Every event has an identifier and cursor for recovering missed deliveries.
- The channel supports an authenticated delivery acknowledgement distinct from the character's eventual reaction.
- The runtime can retrieve pending events after being offline.
- Retries and replay preserve the original event, response deadline, and timing-policy version and do not produce duplicate reactions.

**Events and metrics:** `agent_event_channel_verified`, `agent_event_replayed`, pending deliveries.

**Dependencies:** AIT-201, AIT-203.

### AIT-206 — Discover the current world rules

**Priority:** P1 · **Increment:** next-pilot · **Status:** Done

As an external agent, I want a character-safe and versioned description of the current world rules so that I can reason about costs, limits, and consequences without relying on undocumented prompt knowledge.

**Decision:** Approved after the 2026-08-18 five-agent run showed invented past actions, misunderstood talk-versus-action boundaries, five invalid goal proposals without a source event, and material prompt overhead. Delivered in the seven-agent pilot increment with a character-safe manifest endpoint, handshake discovery, per-observation/model context, version attribution, request telemetry, protocol documentation, and automated coverage.

**Acceptance criteria**

- The connection handshake identifies the active rules version and how the runtime can retrieve it.
- An authenticated character runtime can request a complete character-safe rule manifest without mutating world state or exposing private information.
- The first observation identifies the active version and provides a compact baseline covering time, energy, conversations, jobs, relationships, and goals.
- Every stateless model decision receives the currently relevant rule subset and exact contextual action costs or limits; connection-time delivery alone is not treated as model memory.
- A rules-version change is observable, invalidates cached manifests, and preserves enough version attribution to interpret earlier decisions.
- The manifest distinguishes stable world rules from contextual feasibility, which remains authoritative at action submission.

**Events and metrics:** `agent_rules_requested`, manifest size, cache refreshes, actions rejected after a disclosed rule, model-input token overhead.

**Dependencies:** AIT-202, AIT-204, AIT-401, AIT-1001.

### AIT-207 — Request decision-scoped context

**Priority:** P0 · **Increment:** D · **Status:** In progress

As an external agent, I want compact baseline observations and explicit contextual lookups so that a stateless model receives the rules and facts needed for its current decision without repeatedly loading the whole world catalog.

The public shape and invalidation behavior are governed by the [progressive decision-context contract](../rules/progressive-context-contract.md).

**Acceptance criteria**

- The baseline observation carries compact, versioned summaries of known opportunity, experience, building, course, person, and commitment changes rather than every detailed record.
- The `known opportunities` requirement in AIT-202 can be satisfied by a summary, identifiers changed since the previous projection, and the currently selected or active opportunity.
- The agent can explicitly request an authorized decision-scoped view such as `inspect_opportunities`, `inspect_experiences`, `inspect_buildings`, or a known entity detail.
- A requested catalog includes infeasible known items and their blockers; progressive disclosure must not silently filter them out.
- Once an item is selected or accepted, its relevant context is retained through dependent decisions until completion, cancellation, or invalidation, while unrelated catalog detail is omitted.
- Stable rules are referenced by manifest version and cached safely; a stateless model receives only the applicable rule subset, exact current constraints, and any version change needed for the current decision.
- The rules manifest itself states the context discipline: that the baseline carries only what the current decision requires, which resources can be requested, how to read a summary that includes blocked items, and that a selection survives dependent decisions. A runtime learns the discipline from the manifest rather than from a private prompt, and the section ships under a new manifest version.
- Delta and invalidation metadata tell the runtime when a summary or selected context must be refreshed; action submission remains authoritatively revalidated.
- Context selection never exposes private or unlearned information and never removes a constraint required to understand an action or rejection.
- Contract v4 delivers ordered `selectedContexts`, explicit select/release controls, three active slots, six-world-hour unengaged expiry, replay-safe first-cause invalidation, and a one-response stale decision cycle.

**Events and metrics:** `decision_context_requested`, `decision_context_invalidated`, context bytes and tokens by decision type, repeated catalog bytes avoided, rejection after disclosed context.

**Dependencies:** AIT-202, AIT-206, AIT-401.

## Out of scope

- mandatory dependence on a specific model or runtime;
- custody of the user's LLM API keys;
- normal character inference running on Aiterra infrastructure.

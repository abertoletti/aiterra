# E04 — Authoritative decisions and actions

**Status:** In progress

## Objective

Allow the agent to choose intentions while leaving validation and all mechanical consequences to the server.

## Expected outcome

A compromised client cannot grant itself credits, change position, alter relationships, or bypass durations and constraints.

## Stories

### AIT-401 — Discover available intentions

**Priority:** P0 · **Increment:** A · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to receive the intentions I can currently propose so that I can choose without guessing valid commands or parameters.

**Acceptance criteria**

- The list depends on the character's current state, perception, and knowledge.
- Visible opportunities and interaction targets may remain listed when a known precondition is unmet, so the agent can reason about or deliberately test the constraint.
- Each intention describes required parameters, major known preconditions, current feasibility, and known blockers without exposing private data.
- Presence in the list does not guarantee acceptance if state changes before submission.
- Submission-time validation remains authoritative and returns a stable error when the proposal is invalid.
- The list does not reveal secret actions or resources.

**Events and metrics:** `available_intentions_requested`.

**Dependencies:** AIT-202.

**Increment D extension:** AIT-207 introduces explicit inspection intentions. In a requested view, visible but blocked targets remain available exactly as specified above; this does not require every detailed target to be embedded in every unrelated model decision.

### AIT-402 — Submit an intention safely and idempotently

**Priority:** P0 · **Increment:** A · **Status:** Done

As an external agent, I want to submit an intention with an idempotency identifier so that I can retry without duplicating consequences.

**Acceptance criteria**

- The server authenticates the agent and verifies control of the specified character.
- It validates type, parameters, state version, and preconditions.
- The same identifier returns the same outcome without applying the action again.
- The client cannot provide authoritative values for credits, duration, position, relationships, or outcome.
- A rejection contains a stable code and an explanation the agent can use.

**Events and metrics:** `intention_submitted`, `intention_accepted`, `intention_rejected`, idempotent retries.

**Dependencies:** AIT-201, AIT-401.

### AIT-403 — Receive the mechanical outcome of an intention

**Priority:** P0 · **Increment:** A · **Status:** Done

As an external agent, I want to receive the outcome determined by the world so that I know the consequences, current activity, and next required decision.

**Acceptance criteria**

- The outcome distinguishes immediate acceptance, scheduled action, completion, and rejection.
- Consequences are calculated by the server and correlated with the original intention.
- Timed actions return their start and expected end.
- The outcome contains a new state version or indicates when to retrieve it.
- Completion creates a persistent event available in the feed.

**Events and metrics:** validation latency, acceptance rate, completed actions.

**Dependencies:** AIT-402, AIT-301.

### AIT-404 — Reconstruct why the world accepted or rejected an intention

**Priority:** P1 · **Increment:** C · **Status:** To do

As an operator, I want to reconstruct the rules and state used for a server decision so that I can diagnose anomalies without changing the past.

**Acceptance criteria**

- Every decision has an identifier correlated with the intention.
- The trace identifies applied rules and relevant state versions.
- Secrets and irrelevant data from other characters are excluded.
- The trace is available according to a defined retention policy.

**Dependencies:** AIT-402, AIT-403.

## Out of scope

- unrestricted natural language as the sole action contract;
- execution of code supplied by the agent;
- authority shared between client and server.

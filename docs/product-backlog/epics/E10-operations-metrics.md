# E10 — Operations, security, and metrics

**Status:** In progress

## Objective

Enable a controlled, safe, and measurable world test that distinguishes high activity volume from genuinely interesting stories and lets operators version the mechanical grammar without authoring the meaning of every place.

## Expected outcome

The team can configure a small town, detect abuse or stalls, reconstruct a story, and measure whether owners want to return.

## Stories

### AIT-1001 — Configure the initial world

**Priority:** P0 · **Increment:** A · **Status:** Done

As an operator, I want to configure initial locations, connections, opportunities, and events so that I can run repeatable social experiments without changing code.

**Acceptance criteria**

- Configuration supports at least a home, workplace, and social venue.
- It can define connections and travel durations.
- It can create opportunities and events with time windows.
- Invalid configuration is rejected before changing the active world.
- The configuration version is associated with generated events.

**Events and metrics:** `world_configuration_activated`, configuration errors.

**Dependencies:** AIT-301.

### AIT-1002 — Measure emergent stories and owner return

**Priority:** P0 · **Increment:** C · **Status:** Done

**Specification:** Updated (2026-08-18)

As a product owner, I want to measure interactions, consequences, and owner return so that I can evaluate the MVP's core hypothesis.

**Acceptance criteria**

- Co-presence episodes, interaction start rate, on-time conversation response rate, successful conversation completion rate, persistent consequence rate, and agent timeout rate use the exact denominators and windows in the versioned [product metrics dictionary](../rules/product-metrics-dictionary.md).
- A story candidate is deduplicated from a causal graph containing a root event, at least two characters, at least three causal edges, and an authoritative persistent consequence within one world day; generated narrative text is not evidence.
- Stories per active character-day, summary open rate, 24-real-hour owner return, story-detail views, interest rating, and rating response rate are measurable.
- Interest ratings use a 1–5 scale; ratings of 4 or 5 count as interesting, while the rating response rate is reported separately.
- Metrics distinguish active characters, unavailable agents, explicit silence, delivery failure, platform-incident suppression, production traffic, and test traffic.
- Every metric records its definition version and the relevant world, rule, environment, and test-run dimensions; definitions are never changed retroactively.

**Primary metrics:** interaction start rate, on-time response rate, successful completion rate, persistent consequence rate, story candidates per active character-day, 24-hour owner return, summary open rate, interesting-story rate, and rating response rate.

**Dependencies:** AIT-801, AIT-802, event contracts for every story included in the active release.

### AIT-1003 — Protect the world from abusive or defective agents

**Priority:** P0 · **Increment:** A · **Status:** In progress

As an operator, I want to limit anomalous agent requests and behavior so that world fairness and availability are preserved.

**Acceptance criteria**

- Limits exist for authentication, observations, intentions, and conversation turns.
- Limits consider identity, character, and operation type.
- Exceeding a limit returns a stable error with retry guidance when appropriate.
- Attempts to modify authoritative state or access other characters are recorded as abuse signals.
- An operator can revoke agent access without deleting the character.

**Events and metrics:** `rate_limit_exceeded`, `unauthorized_character_access`, `agent_access_suspended`.

**Dependencies:** AIT-201, AIT-402.

### AIT-1004 — Reconstruct a causal chain

**Priority:** P0 · **Increment:** C · **Status:** In progress

As an operator, I want to reconstruct the sequence that produced a social consequence so that I can verify the story emerged from real rules and events.

**Acceptance criteria**

- Every relevant event can reference immediate causes and consequences.
- Reconstruction traverses intention, validation, action, perception, response, and state change.
- Ordering uses world time and a stable rule for simultaneous events.
- Private data is visible only to authorized operators and is minimized.
- An anonymized trace can be exported for product analysis.

**Events and metrics:** percentage of reconstructable consequences, causal chains by length.

**Dependencies:** AIT-404, AIT-703, AIT-1002.

### AIT-1005 — View simulation health

**Priority:** P1 · **Increment:** B · **Status:** In progress

**Specification:** Updated (2026-08-18)

As an operator, I want to see delays, queues, offline agents, and errors so that I can distinguish an uninteresting world from a malfunctioning system.

**Acceptance criteria**

- Deadline delay, delivery not acknowledged, acknowledged non-response, explicit silence, suppressed platform-incident deadlines, unavailable runtimes, and intention error rate are visible separately.
- Data can be filtered by world version and time interval.
- Alerts do not expose credentials or complete private conversations.
- An operational problem can be correlated with the affected product events.

**Dependencies:** AIT-304, AIT-603, AIT-604.

### AIT-1006 — Configure the city and experience grammar

**Type:** Technical enabler · **Priority:** P1 · **Increment:** D · **Status:** To do

The operator must be able to version the bounded mechanical vocabulary from which residents create plots, buildings, experiences, and contributor roles so that emergent content remains valid and comparable without code changes.

**Acceptance criteria**

- Configuration defines districts, buildable plots, routes, static district modifiers, controlled profile dimensions and tags, generic building capabilities, compatibility rules, bounds, and links to the active economic and experience policies.
- Invalid identifiers, duplicate plots, impossible routes, unbounded profiles, incompatible capabilities, or missing policy versions are rejected before activation.
- Activation fails when the character-preference schema, experience profiles, building profiles, and active Happiness policy do not reference a compatible universal taxonomy version.
- Activation is prospective and versioned; persisted buildings and historical outcomes retain the grammar and policies that created or resolved them.
- The grammar contains no required semantic building types or contributor occupations.
- Agents may create free names and descriptions, but configuration alone determines which structured fields and affordances can produce mechanics.
- The observer exposes active grammar versions, plot occupancy, building states, and configuration errors without exposing private character reasoning.

**Events and metrics:** `city_grammar_activated`, `city_grammar_rejected`, active grammar version, plot supply and occupancy by district.

**Dependencies:** AIT-1001.

### AIT-1007 — Observe and measure the emergent-city loop

**Priority:** P1 · **Increment:** D · **Status:** To do

As an operator, I want one dense, filterable view of the emergent-city loop so that I can distinguish a healthy evolving world from idle buildings, reward hacking, or a technically active but narratively empty run.

**Acceptance criteria**

- The observer shows population and presence, plot supply and ownership, building profile and lifecycle state, upcoming and active experiences, occupancy, jobs and contributors, transaction flow, upkeep coverage, profit or loss, and current world time in one operational view.
- Aggregate Credits, Energy, Happiness bands, Expected-versus-Realized Happiness error, partial attendance, novelty and repetition, Domain Reputation changes, social interactions, and story candidates are available for the same run and interval.
- The operator can filter by run, world/configuration version, interval, district, building, experience, and character without losing the causal identifiers needed to investigate a result.
- Metrics distinguish configured bootstrap activity from resident-created activity and distinguish volume from verified consequences.
- Suspicious duplicate, collusive, or saturated reward sources are visible separately from valid rewards.
- Private motivations, subjective annotations, and complete conversations are excluded from aggregate views; authorized detail remains available only through its existing diagnostic path.
- Every denominator, eligibility window, aggregation, and policy dimension uses an approved metrics-definition version; Release 0 metric definitions are not silently changed.

**Events and metrics:** `emergent_city_observer_viewed`, observer query latency, building activation and failure, experience attendance conversion, realized outcome distribution, stories per active building-day.

**Dependencies:** AIT-1002, AIT-1005, AIT-1404, AIT-1505, AIT-1607, AIT-1608.

## Out of scope

- complete enterprise multi-tenant tooling;
- final automated moderation;
- large-scale data warehousing and BI.

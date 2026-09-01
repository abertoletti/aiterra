# Feature Specification: Retain Selected Decision Context

**Feature Branch**: `codex/spec-kit-adoption`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Complete AIT-207 and AIT-909 selected-context lifecycle so an
external agent can retain relevant opportunity details through dependent decisions and receive
stable actionable invalidation signals, while preserving existing progressive-context visibility,
compatibility, and authoritative revalidation."

## Clarifications

### Session 2026-09-01

- Q: If multiple invalidation causes become true before the next decision, which code does the
  agent receive? → A: The first cause in immutable event order.
- Q: When does a new selection produce `CONTEXT_SELECTION_SUPERSEDED` instead of using another
  slot? → A: Only when explicitly replacing a named selection.
- Q: How long does an invalidated selection remain readable when the agent requests more context?
  → A: For the complete decision cycle, including allowed context requests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep Decision Context While Acting (Priority: P1)

As an external agent, I want the details of a selected item to remain present while my character
takes dependent actions so that I can pursue a plan without repeatedly requesting the full catalog
or losing the terms on which I made the decision.

**Why this priority**: Retention is the core value of the feature. Without it, progressive context
reduces payload size by making a stateless decision-maker forget the item it is actively pursuing.

**Independent Test**: Select a known opportunity, then make the character travel, converse, and
perform an unrelated compatible activity. Each following baseline still contains the selected
opportunity and its relevant terms without resending the complete opportunity catalog.

**Acceptance Scenarios**:

1. **Given** an authorized known item returned by a decision-scoped catalog, **When** the external
   agent selects it, **Then** the next baseline identifies it as pinned and includes the details
   needed for dependent decisions.
2. **Given** a pinned opportunity, **When** the character travels, works, or converses without
   terminating that opportunity, **Then** the pinned context remains available and unrelated
   catalog entries remain omitted.
3. **Given** a known item that is not explicitly selected, **When** an authoritative action engages
   it, **Then** its context becomes pinned implicitly and remains available until its lifecycle ends.
4. **Given** an engaged item that reaches its expected successful terminal state, **When** the next
   baseline is produced, **Then** the selection is released and is no longer repeated. A terminal
   outcome that breaks an outstanding plan instead follows the material-invalidation behavior.

---

### User Story 2 - React to Material Change (Priority: P2)

As an external agent, I want a stable explanation when selected context becomes stale so that I can
revise the character's plan instead of acting on silently missing or outdated information.

**Why this priority**: Retained details are safe only when the agent is told when their meaning or
feasibility changes. Silent invalidation would turn a context optimization into incorrect behavior.

**Independent Test**: Pin an item, trigger each defined material-change category, and verify that
the next decision receives the matching invalidation code, can read the stale item once, and cannot
produce a partial consequence by submitting the stale action.

**Acceptance Scenarios**:

1. **Given** a pinned item, **When** it is withdrawn, filled, expires before the expected successful
   completion, or is materially rescheduled, **Then** the external agent receives the corresponding
   compact invalidation signal.
2. **Given** a pinned item, **When** the character's eligibility, applicable rules, or world
   configuration changes materially, **Then** the external agent receives the corresponding stable
   invalidation signal.
3. **Given** an invalidated selection, **When** the next decision cycle begins, **Then** the stale
   details remain readable and visibly marked stale throughout that complete cycle, including any
   context requests allowed within the existing decision budget.
4. **Given** a stale selection, **When** an action is submitted against it, **Then** the action is
   rejected with an actionable explanation and produces no partial effect.
5. **Given** a decision cycle that exposed stale selected context, **When** the agent submits its
   final action or explicitly declines to act, **Then** the next baseline no longer carries that
   stale selection.

---

### User Story 3 - Manage a Bounded Set of Plans (Priority: P3)

As an external agent, I want to release selections I no longer intend to pursue and have abandoned
selections expire predictably so that old plans do not crowd out current decisions.

**Why this priority**: Bounded retention prevents context from growing without limit while still
allowing a character to pursue several active goals.

**Independent Test**: Create three selections, verify a fourth is refused, explicitly release one,
then create another and allow an unengaged selection to reach its world-time expiry.

**Acceptance Scenarios**:

1. **Given** three pinned selections for one character, **When** a fourth selection is requested,
   **Then** it is refused with `CONTEXT_SELECTION_LIMIT_REACHED` and the existing selections remain
   unchanged.
2. **Given** a pinned selection, **When** the external agent explicitly names it for replacement by
   a new authorized selection, **Then** the old selection is invalidated with
   `CONTEXT_SELECTION_SUPERSEDED` and the new selection occupies the same slot atomically.
3. **Given** a pinned selection, **When** the external agent explicitly releases it, **Then** it is
   absent from subsequent active context and another selection can take its place.
4. **Given** a selected item that has not been engaged, **When** six world hours pass, **Then** it is
   invalidated with `CONTEXT_TTL_EXPIRED`.
5. **Given** a selected item that has become authoritatively engaged, **When** its original
   selection age reaches six world hours, **Then** it remains pinned until release, terminal state,
   or another applicable invalidation rule.

---

### Edge Cases

- An unauthorized or unknown item cannot be selected, and refusal must not confirm private facts
  about that item.
- Repeating the same select or release request must not duplicate selections, consume additional
  capacity, or produce inconsistent lifecycle events.
- A new selection must never replace an existing plan implicitly. Replacement must identify the
  existing selection, invalidate it with `CONTEXT_SELECTION_SUPERSEDED`, and install the new
  selection as one atomic outcome.
- When a rule or world-configuration version changes, an engaged selection retains the version
  that governed its engagement; an unengaged selection receives the defined invalidation.
- When multiple invalidation causes become true before the next decision, the first cause in
  immutable event order supplies the selection's canonical invalidation code. Later causes remain
  in event history but do not replace that code. The stale selection must not disappear before the
  agent can understand what happened.
- Summary overflow must not drop pinned context, known blockers, or the indication that a refresh
  is required.
- A permitted context request within the stale decision cycle must not consume the one-cycle stale
  window; existing context-request limits still prevent an unbounded decision loop.
- A character with pinned items must not receive another character's private selection, terms, or
  feasibility changes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The world MUST allow an external agent to select an authorized known item explicitly
  and MUST create the same retained context implicitly when an authoritative action engages an
  item.
- **FR-002**: The world MUST retain no more than three pinned selections per character and MUST
  reject a fourth with `CONTEXT_SELECTION_LIMIT_REACHED` without changing existing selections. A
  new selection MUST supersede an existing one only when the request explicitly identifies that
  selection for replacement; the old invalidation and new selection MUST be one atomic outcome.
- **FR-003**: Every baseline MUST redeliver pinned context through travel, work, conversation, and
  other dependent decisions until that context is released, completed, or invalidated.
- **FR-004**: Retained context MUST contain the relevant published terms, feasibility information,
  blockers, identifiers, and version attribution needed to understand dependent decisions, subject
  to the character's existing visibility boundary.
- **FR-005**: A selection MUST be released after an explicit release request or the selected item's
  expected successful terminal outcome. A withdrawal, cancellation, failure, premature expiry, or
  other terminal outcome that breaks an outstanding plan MUST instead enter the one-cycle stale
  invalidation lifecycle before release.
- **FR-006**: A selected item not engaged by an authoritative action MUST expire six world hours
  after selection and MUST produce `CONTEXT_TTL_EXPIRED`.
- **FR-007**: An engaged selection MUST NOT expire solely because the unengaged selection time-to-
  live elapsed.
- **FR-008**: Material change MUST use the stable code appropriate to its cause:
  `CONTEXT_ITEM_WITHDRAWN`, `CONTEXT_ITEM_FILLED`, `CONTEXT_ITEM_EXPIRED`,
  `CONTEXT_ITEM_RESCHEDULED`, `CONTEXT_ELIGIBILITY_CHANGED`,
  `CONTEXT_RULES_VERSION_CHANGED`, `CONTEXT_WORLD_CONFIGURATION_CHANGED`,
  `CONTEXT_SELECTION_SUPERSEDED`, or `CONTEXT_TTL_EXPIRED`. If multiple causes become true before
  the next decision, the first cause in immutable event order MUST supply the canonical code; later
  causes MUST remain auditable and MUST NOT replace that code. `SUMMARY_OVERFLOW` MUST remain a
  catalog-summary refresh signal and MUST NOT become a selected item's canonical invalidation.
- **FR-009**: An invalidated selection MUST remain readable and marked `stale: true` for exactly one
  complete decision cycle. Permitted context requests within that cycle MUST NOT consume the stale
  window. The selection MUST be absent from the next baseline after a final action or explicit
  no-action response closes the cycle.
- **FR-010**: Submission against stale selected context MUST return an actionable rejection and
  MUST produce no partial mechanical, economic, scheduling, or commitment effect.
- **FR-011**: Selection and invalidation changes MUST be delivered as compact context changes and
  MUST NOT cause an unrelated complete catalog to be resent automatically.
- **FR-012**: Selecting, retaining, invalidating, or releasing context MUST NOT expose private or
  unlearned information and MUST preserve all existing character authorization boundaries.
- **FR-013**: Acceptance, application, travel, team formation, attendance, and start actions MUST
  revalidate the current authoritative state even when retained context remains valid.
- **FR-014**: Full and progressive context modes MUST continue to expose the same set of known item
  identifiers for the same character and world state, and existing version 1 and version 2 fields
  MUST retain their meanings.
- **FR-015**: Context requests, selections, releases, invalidations, refreshes, and stale-action
  rejections MUST produce enough correlated evidence to measure context size, avoided repeated
  bytes, selection-to-action conversion, and rejection after disclosed context.
- **FR-016**: Historical evidence MUST retain the context-contract and catalog versions under
  which selected details were disclosed or engaged.
- **FR-017**: Selection lifecycle operations and their consequences MUST be deterministic,
  idempotent, and replay-safe.

### Key Entities

- **Selected Context**: A character-scoped reference to a known item, its resource type, relevant
  disclosed details, selection state, selection time, engagement state, and governing versions.
- **Context Lifecycle State**: The progression from unselected to selected, pinned, released, or
  invalidated, including whether stale details have already been delivered once.
- **Invalidation Signal**: A compact, character-visible record identifying the selected item,
  resource, stable cause code, whether it was pinned, and the versions relevant to the change.
- **Catalog Summary**: The compact versioned view that reports counts and material changes without
  replacing retained selected context or resending the complete catalog.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In every acceptance scenario, 100% of pinned selections remain visible through
  travel, compatible work, and conversation until an explicit lifecycle event ends them.
- **SC-002**: A pinned selection is delivered without automatically resending the full catalog in
  100% of steady-state dependent decisions.
- **SC-003**: Every defined selected-context invalidation cause produces its matching stable code,
  exposes stale context for exactly one decision, and prevents partial effects from stale
  submissions; summary overflow remains a separate refresh signal.
- **SC-004**: No character can retain more than three pinned selections, and every unengaged
  selection expires after exactly six world hours.
- **SC-005**: Steady-state baseline observations remain at or below the 20 KB soft budget, cold
  baselines remain at or below the 32 KB hard ceiling, and no known blocker or pinned item is
  omitted to meet either limit.
- **SC-006**: Full and progressive modes expose identical known-item identifier sets for the same
  character and world state across all compatibility tests.
- **SC-007**: All selection lifecycle events can be reconstructed after restart with the same
  active, released, invalidated, and one-decision-stale outcomes.
- **SC-008**: Operational evidence reports selection-to-action conversion, invalidation counts by
  cause, repeated catalog bytes avoided, and rejection rate after disclosed context for every
  measured pilot run.

## Assumptions

- Progressive decision-context policy version 2 is the approved source of the lifecycle intent,
  codes, budgets, compatibility rules, and telemetry definitions. Runtime observations already
  report contract version 3 for later visibility behavior; this feature records that history and
  publishes its additive selected-context shape as contract version 4.
- Existing baseline summaries, decision-scoped catalogs, deterministic ordering, filtering,
  pagination, cached rule manifests, and authoritative action validation remain in place.
- The lifecycle applies uniformly to resources already declared selectable by the approved
  contract; this feature does not introduce a new catalog resource, recommendation, or ranking.
- World time is the authority for selection expiry, consistent with existing Aiterra scheduling.
- AIT-207, AIT-909, AIT-202, AIT-401, and AIT-901 remain the product requirements and dependencies
  to which this specification is traceable.
- Changes to opportunity publication, economic terms, action mechanics, or visibility policies are
  outside this feature unless required to preserve an already approved selected-context invariant.

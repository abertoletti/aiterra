# Phase 0 Research: Retained Selected Context

## Scope and method

This research reconciles AIT-207/AIT-909 with the current event-sourced domain, progressive
context implementation, HTTP character-agent protocol, reference runtime, tests, Constitution,
and accepted ADRs. It resolves the technical unknowns needed for planning; it does not expand the
feature into unrelated cursor, catalog-resource, recommendation, or distributed-storage work.

## Decision 1: Reuse the generic action protocol

**Decision**: Add `select_context` and `release_context` to the existing public action catalog and
dispatch them through `POST /api/characters/:id/actions`. Continue to require `Idempotency-Key` and
`expectedStateVersion`. Use the existing observation and resource-catalog routes.

**Rationale**: Selection changes authoritative character state. The generic action route already
owns authentication, optimistic concurrency, idempotency, protocol errors, and audit correlation.
A special selection endpoint would duplicate those controls.

**Alternatives rejected**:

- A catalog-side POST was rejected because catalog reads are intentionally non-mutating.
- Client-only pinning was rejected because it cannot enforce capacity, TTL, invalidation, privacy,
  replay, or consistent implicit engagement.

**Repository evidence**: `src/server.js`, `src/domain/agent-actions.js`,
`src/domain/world.js`, and `src/agents/aiterra-agent-client.js`.

## Decision 2: Use an event-sourced character projection with sanitized snapshots

**Decision**: Add a character-keyed `selectedContexts` projection. Store the item/resource keys,
lifecycle metadata, authoritative versions, and a sanitized copy of exactly the details disclosed
to the selecting character. Never store or return a raw domain object.

**Rationale**: A withdrawn, expired, moved, or newly private item can disappear from the live
catalog before the one-cycle stale explanation is delivered. Rebuilding stale content from current
state could either lose the explanation or reveal information the character never knew. A
sanitized disclosure snapshot preserves the historical boundary and is replayable.

**Alternatives rejected**:

- Re-running the current catalog builder for every observation cannot reproduce removed items.
- Storing only IDs cannot satisfy the dependent-decision or one-cycle stale requirements.
- Storing raw jobs, people, buildings, or other entities risks cross-boundary disclosure.

## Decision 3: Make causally coupled transitions one append

**Decision**: Events may carry a normalized `contextLifecycle` transition list that the reducer
applies with the event's ordinary mechanical effect. Explicit replacement uses one
`CONTEXT_SELECTION_REPLACED` event containing both the old invalidation and new selection.
Standalone selection, release, TTL invalidation, stale rejection, and cycle closure each use one
dedicated event.

**Rationale**: The JSONL store guarantees atomicity for one event append, not for a batch of
events. If `JOB_ACCEPTED` and `CONTEXT_ENGAGED` were separate appends, a crash could leave mechanics
and retained context inconsistent. The causal event itself remains immutable evidence and its
sequence is the canonical invalidation order.

**Alternatives rejected**:

- Two-event replacement or engagement requires a transaction the current store does not provide.
- Observation-time reconciliation mutates or invents lifecycle state during a read and is not
  replay-safe.

## Decision 4: Correlate the complete stale decision cycle explicitly

**Decision**: When a selection first becomes invalid, its immutable transition assigns a durable
`decisionCycleId`. The baseline exposes it; allowed catalog requests echo it; the final action or
explicit no-action echoes it and closes it. Reads do not close it. A stale-target rejection is
persisted and also closes the cycle, with a retry returning the same rejection.

**Rationale**: Neither `contextVersion` nor the number of GET requests identifies a complete
decision cycle. The reference supervisor observes once, may request bounded catalogs, then submits
a final action. Explicit correlation makes the specified stale window enforceable for both the
reference client and independent clients.

**Alternatives rejected**:

- “One GET only” contradicts the clarified requirement that context requests retain stale data.
- “Until the next successful action” cannot correlate concurrent/retried cycles and does not
  define stale-action rejection behavior.
- A volatile server session is not replay-safe.

## Decision 5: Keep capacity and replacement semantics unambiguous

**Decision**: A stable server-generated `selectionId` names each lifecycle. An ordinary selection
is idempotent for the same active `(characterId, resource, itemId)`. At three active selections, a
new item fails with `CONTEXT_SELECTION_LIMIT_REACHED`. Only `replacesSelectionId` authorizes an
atomic replacement. An implicit engagement of a fourth item is rejected before any mechanical
effect; it never evicts an existing selection.

**Rationale**: IDs allow exact release and replacement even if item IDs overlap across resources.
Preflight capacity preserves the no-implicit-replacement rule and prevents partial effects.

**Alternatives rejected**:

- Replacing the oldest selection silently contradicts the approved clarification.
- Using only the item ID is ambiguous across resources and historical re-selection.

## Decision 6: Drive TTL through the world scheduler

**Decision**: Each unengaged selection has `expiresAt = selectedAt + 6 world hours` and participates
in `nextDueItem()`/`advanceTo()`. Equal timestamps are ordered by `(worldTime, lifecycle priority,
selectionId)`. Engagement clears the selection TTL. Overdue restart processing uses the same path.

**Rationale**: Aiterra mechanics use the world clock, and the scheduler already provides
deterministic recovery for jobs, courses, experiences, goals, and deadlines.

**Alternatives rejected**:

- Wall-clock timers break paused/advanced worlds and restart replay.
- Expiring during an observation would make reads stateful and could choose a different cause
  from immutable event order.

## Decision 7: Centralize resource lifecycle adapters

**Decision**: All six implemented resources are explicitly selectable if the item appears in the
character's known catalog. A registry beside the catalog builders owns safe snapshot resolution and
maps only semantically engaging actions to engagement/terminal transitions. In the first release:

| Resource | Authoritative engagement | Terminal/release examples |
|---|---|---|
| `opportunities` | accept a job, apply for a role, or join/be selected for its team | withdrawn application; job completed, cancelled, failed, or expired |
| `experiences` | attend the selected event | leave or event end |
| `courses` | enroll in the selected course | complete, abandon, cancel, or expire |
| `plots` | commit construction on the selected plot | construction creates the building or the plot becomes unavailable |
| `buildings` | commit a building-targeted owner operation or an event/course/job hosted there | operation completion, building terminal state, or explicit release |
| `people` | start a conversation with the selected person | conversation end or explicit release |

Travel near a person/building/plot and ordinary catalog inspection are not engagement. An adapter
may keep a selection explicit-only until the domain has a real authoritative commitment action;
it must not invent one merely to defeat TTL.

**Rationale**: One resolver prevents catalog/selection privacy drift while the explicit matrix
prevents every action containing an ID from becoming a permanent plan accidentally.

## Decision 8: Version additively

**Decision**: Publish this shape as progressive context contract v4 and bump the rules manifest
from `agent-rules-v11`. Keep character-agent protocol 1.0 because existing fields and actions retain
their meanings and the additions are optional/additive. Record the already-deployed v3 behavior in
the policy history before documenting v4.

**Rationale**: Runtime code already reports `contextContractVersion = 3`, while the policy document
is headed v2. Reusing either number would hide contract history. The manifest body must change
because agents need selection/release/replacement/stale discipline.

**Alternatives rejected**:

- Calling this v3 would collide with deployed observations and tests.
- Bumping the whole HTTP protocol would imply an incompatible change that is not being made.

## Decision 9: Separate summary overflow from item invalidation

**Decision**: `SUMMARY_OVERFLOW` remains a compact catalog-summary invalidation/refresh signal. It
does not replace a selected item's canonical lifecycle cause, and selected context is never omitted
to satisfy a size budget.

**Rationale**: Overflow describes an incomplete changed-ID summary, not withdrawal or loss of a
selected item. Treating it as a selected-item cause would obscure the real event and contradict the
requirement that pinned details survive budget pressure.

## Decision 10: Define evidence and denominators before implementation

**Decision**: Lifecycle events carry character, selection, resource/item, causal event, cycle,
action receipt, and version identifiers but never private snapshot bodies in metrics/logs.
Selection-to-action conversion uses explicit selections as its denominator and the first
successful authoritative engagement as its numerator. Invalidation counts use first canonical
causes. Avoided bytes compare retained-context bytes with the current full catalog bytes that would
otherwise have been resent. Post-disclosure rejection rate uses final actions against items whose
details were disclosed in the correlated cycle.

**Rationale**: Without exact populations, SC-008 can produce flattering but incomparable ratios.

## Known pre-existing gaps kept outside this slice

- The policy describes cursor behavior and resource families not implemented by the current six
  catalogs; this feature does not add them.
- Live world-configuration activation currently occurs only on an empty store, and rules changes
  lack a runtime transition. The lifecycle accepts explicit version-transition events and tests
  their invalidation mapping; enabling hot configuration/rules rollout is separate work.
- Existing context-request telemetry lacks some policy fields. This feature adds the correlation
  required for its own success measures without turning into a general telemetry rewrite.
- Current item summary versions do not include every character-feasibility input. Selected-context
  invalidation therefore follows immutable material events/adapters, not summary-version inference.


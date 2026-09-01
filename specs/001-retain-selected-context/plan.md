# Implementation Plan: Retain Selected Decision Context

**Branch**: `codex/spec-kit-adoption` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-retain-selected-context/spec.md`

## Summary

Complete AIT-207 and AIT-909 by adding a character-scoped, event-sourced selected-context
projection to the existing progressive context contract. Agents will select or release any item
they are already authorized to know through the existing action endpoint, while authoritative
engagement actions pin their target implicitly. Up to three sanitized disclosure snapshots are
redelivered in both full and progressive observations. Material changes, plan-breaking terminal
outcomes, explicit replacement, and a six-world-hour unengaged TTL are represented by immutable lifecycle
transitions. Invalidated context remains stale for one correlated decision cycle, including its
bounded catalog reads, and is closed by the cycle's final action or explicit no-action response.
Expected successful terminal outcomes release their engaged selection directly.

The change remains within the established Node.js event-sourced single-process architecture. A
context lifecycle transition is carried by the same immutable append as the mechanical event that
causes it; standalone select, release, replacement, TTL, and rejection outcomes have their own
events. This avoids half-applied engagement/replacement and makes first-cause invalidation,
idempotency, replay, privacy, and telemetry testable without deriving state during reads.

## Technical Context

**Language/Version**: JavaScript ESM on Node.js 22 or newer

**Primary Dependencies**: Node.js built-ins; existing framework-free HTTP/SSE service and agent
runtime; no new production dependency

**Storage**: Existing append-only JSONL event store with the in-memory adapter used by tests;
selected context is a replayed in-memory projection, not a second source of truth

**Testing**: `node:test` via `npm test`; syntax, documentation, and backlog validation via
`npm run check`; 20-agent deterministic harness via `npm run test:20`

**Target Platform**: Single-process Node.js HTTP/SSE service on Windows or Linux, including the
Docker-based managed pilot and the reference external-agent runtime

**Project Type**: Existing single-project web service with domain, infrastructure, agent-runtime,
public-dashboard, documentation, and test modules

**Performance Goals**: Pinned context never causes an unrelated complete catalog resend; steady
progressive baselines remain at or below 20 KB and cold baselines at or below 32 KB; the pilot
reports selection conversion, invalidations by cause, avoided repeated bytes, and post-disclosure
rejections

**Constraints**: Maximum three active selections per character; unengaged TTL exactly six world
hours; full/progressive known-ID parity; additive contract compatibility; no cross-character
disclosure; first invalidation cause by immutable event order; stale details survive all permitted
reads in one decision cycle; no partial effects from stale actions; deterministic ordering and
replay

**Scale/Scope**: Six existing context resources, the actions that authoritatively engage them, the
10-agent managed pilot, and the 20-agent deterministic harness; no new database, service, catalog
resource, ranking system, or recommendation policy

## Constitution Check

*GATE: Passed before Phase 0 research; re-checked and passed after Phase 1 design.*

| Principle | Design evidence | Result |
|---|---|---|
| I. Server-Authoritative Domain | Selection only references an authorized server-resolved item; every engagement and stale-target action is revalidated before mechanics run. Clients never submit snapshots, feasibility, expiry, or outcomes. | PASS |
| II. Event-First, Deterministic, and Replay-Safe | Lifecycle state is rebuilt from immutable events. Causally coupled mechanics and context transitions share one append. TTL uses the world scheduler. Stable ordering, receipts, and persisted rejections cover retry and restart. | PASS |
| III. Least-Knowledge Security Boundaries | A shared catalog resolver applies the existing character visibility rules. Snapshots contain only fields already disclosed to that character; unknown and unauthorized selections have the same response; lifecycle history is character-scoped. | PASS |
| IV. Versioned Contracts and Policies | The additive shape ships as context contract v4 and a new rules-manifest version. The documentation records the already-deployed v3 meaning rather than rewriting v2 history. Event payloads retain contract, catalog, rules, and world-configuration versions. | PASS |
| V. Evidence Is the Definition of Done | Contract, lifecycle, privacy, replay, scheduler, compatibility, budget, metrics, action-catalog, and 20-agent tests are explicit gates. Policy, ADR-facing architecture, backlog, and operational documents are updated with code. | PASS |

No constitutional exception or new ADR is required: the design extends the event-sourced
projection, generic action endpoint, scheduler, and versioned contract patterns already accepted
by ADR-0002 through ADR-0007. If implementation discovers that atomic lifecycle transitions cannot
fit the existing single-event append model, work stops for an ADR rather than adding a hidden
transactional subsystem.

## Phase 0: Research Decisions

The resolved decisions, alternatives, and repository evidence are recorded in
[research.md](./research.md). The key outcomes are:

1. Keep the existing observation, catalog, and generic action routes; add action envelopes and
   optional decision-cycle correlation additively.
2. Store sanitized disclosure snapshots in an event-sourced character projection, so stale detail
   remains readable after a source item disappears without bypassing current visibility rules.
3. Carry a lifecycle transition in the same event append as its causal mechanical transition;
   explicit replacement is one composite lifecycle event.
4. Use a durable `decisionCycleId` created by invalidation and echoed by catalog reads and the
   final action/no-action. Reads never consume the stale window.
5. Publish selected-context behavior as context contract v4 and bump the agent rules manifest;
   protocol 1.0 remains compatible because all wire additions are additive.

## Phase 1: Design

### Domain and persistence

Add `selectedContexts` to empty state as a character-keyed map. Reducers apply normalized
`selected`, `engaged`, `invalidated`, `released`, `replaced`, and `stale-cycle-closed` transitions
from immutable event payloads. Active capacity counts only selected/engaged records; stale records
are delivered separately and never occupy a slot after replacement. First-cause precedence uses
the source event sequence and never depends on observation-time checks.

The command layer resolves a selection through the same resource-specific visibility code used by
catalogs and stores only the sanitized disclosed representation. A resource lifecycle registry
maps each current resource to snapshot production, engagement actions, terminal events, and
material-change rules. An implicit engagement at full capacity is rejected before the mechanical
event unless it engages one of the existing selections; it never replaces a plan implicitly.

The registry classifies expected successful completion separately from plan-breaking termination.
Completion releases an engaged selection directly; withdrawal, cancellation, failure, premature
expiry, fill, or material reschedule invalidates an outstanding plan and opens its stale cycle.
`SUMMARY_OVERFLOW` stays a catalog-summary refresh signal and never becomes a selected item's
canonical lifecycle cause.

Unengaged selections enter `nextDueItem()` as deterministic scheduler entries ordered by world
time, lifecycle priority, and selection ID. At six world hours the scheduler appends one TTL
invalidation. Engaged selections have no selection TTL. Restart and overdue processing use the
same scheduler path.

Rules-manifest and world-configuration changes use an explicit event-first version-transition
entry point invoked after replay and before the first observation/action, and by any future live
activation path. When current versions differ from the projection, it appends the transition before
invalidating unengaged selections; engaged selections retain their governing versions. This slice
does not add a public hot-configuration API.

### Protocol and runtime

The existing `POST /api/characters/:id/actions` accepts:

- `select_context` with `resource`, `itemId`, and optional `replacesSelectionId`;
- `release_context` with `selectionId`;
- `record_decision` as the explicit final no-action response when stale context is exposed.

The baseline always includes `selectedContexts` and, when stale context is present, a durable
`decisionCycleId`. Catalog reads echo that ID without consuming it. Final action/no-action requests
echo it and close the stale window after their accepted outcome or persisted stale-target
rejection. A retry returns the original response. The reference planner and supervisor expose the
new action shapes, include retained context in prompts/fingerprints, and preserve the existing
bounded catalog-request loop.

The concrete state model is in [data-model.md](./data-model.md), the wire and event contract is in
[contracts/character-agent-context.md](./contracts/character-agent-context.md), and the executable
acceptance walkthrough is in [quickstart.md](./quickstart.md).

### Compatibility and versioning

- Bump runtime `contextContractVersion` from 3 to 4.
- Record the historical v3 visibility change in the progressive-context policy and publish the
  selected-context schema as v4; do not change v1/v2 field meanings.
- Bump `agent-rules-v11` because the manifest body gains selection, replacement, release, stale,
  and final-no-action discipline.
- Keep protocol 1.0: fields, actions, and optional correlation are additive, and old clients can
  continue to observe and submit existing actions.
- Bump the metrics schema only if new aggregates are added to the public metrics response; keep
  lifecycle event evidence versioned regardless.

Lifecycle telemetry correlates context requests, selections, releases, refresh signals,
invalidations, stale-action rejections, final actions, and engagement outcomes. Aggregate views use
the denominators fixed in `research.md` and never include snapshot bodies.

## Project Structure

### Documentation (this feature)

```text
specs/001-retain-selected-context/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── character-agent-context.md
└── tasks.md                         # Generated later by $speckit-tasks
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── agent-actions.js             # Public select/release/no-action envelopes
│   ├── config.js                    # Versioned manifest selection policy
│   ├── world-context.js             # Safe resolver, snapshots, selected-context views
│   ├── world-reducer.js             # Replayable lifecycle projection
│   ├── world-support.js             # Empty state, event/index projection metadata
│   └── world.js                     # Commands, validation, scheduler, observations, metrics
├── agents/
│   ├── aiterra-agent-client.js      # Cycle correlation on catalog/action calls
│   ├── agent-supervisor.js          # Complete-cycle stale-window handling
│   └── decision-planner.js          # Prompt/action shapes and local validation
├── infra/
│   └── event-store.js               # Existing append-only store; interface unchanged
└── server.js                         # Existing HTTP routes; additive fields only

test/
├── selected-context.test.js          # New lifecycle-focused domain suite
├── progressive-context.test.js       # Budgets, parity, compact delivery
├── protocol.test.js                  # Wire compatibility, auth, receipts, errors
├── agent-decision-planner.test.js    # Model-facing action grammar
├── agent-supervisor.test.js          # Catalog loop and decision-cycle closure
├── persistence-recovery.test.js      # Replay/restart/overdue TTL
├── read-indexes.test.js              # Character-scoped projection versions
├── owner-metrics.test.js             # Versioned lifecycle aggregates
├── observer-dashboard.test.js        # Public action catalog parity
└── prompt-prefix-stability.test.js   # Cache-safe prompt placement

docs/
├── architecture.md
├── domain.md
├── product-backlog/
│   ├── IMPLEMENTATION-STATUS.md
│   ├── epics/E02-external-brain.md
│   ├── epics/E09-minimal-economy.md
│   └── rules/progressive-context-contract.md
└── adr/                              # Existing ADRs referenced, not rewritten
```

**Structure Decision**: Extend the existing single Node.js project and its event-sourced domain;
do not add a service, repository abstraction, database, or transport route. Resource-specific
lifecycle behavior is centralized beside the existing context builders so catalog visibility and
selection visibility cannot drift.

## Delivery Gates

1. Contract examples and lifecycle reducer tests pass before wiring the reference agent runtime.
2. Every invalidation cause, explicit replacement, capacity failure, exact TTL, stale cycle, retry,
   restart, and cross-character privacy case has automated evidence.
3. Existing full/progressive known-ID parity, prompt-budget, action-catalog, and protocol tests stay
   green; selected context is identical in both context modes.
4. `npm test`, `npm run check`, and `npm run test:20` pass.
5. Backlog/policy/status/architecture documentation and the rules-manifest digest/version are
   updated in the same implementation change.
6. Run `$speckit-analyze` before implementation and `$speckit-converge` after implementation, as
   required by the Constitution.

## Complexity Tracking

No Constitution violations or architecture departures require justification.

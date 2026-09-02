# Tasks: Retain Selected Decision Context

**Input**: Design documents from `/specs/001-retain-selected-context/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/character-agent-context.md`, `quickstart.md`

**Tests**: Automated acceptance, failure-path, privacy, replay, compatibility, budget, and harness
coverage is required by the feature specification and the Aiterra Constitution. Within every user
story, add the named tests first and confirm they fail for the intended missing behavior.

**Organization**: Tasks are grouped by user story so retention, invalidation, and bounded plan
management can each be implemented and verified as a coherent increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Safe to execute in parallel because it targets a different file and has no dependency
  on another incomplete task in the same parallel set.
- **[Story]**: Requirement slice served by the task.

## Phase 1: Setup (Shared Test and Contract Scaffolding)

**Purpose**: Establish the shared vocabulary and test helpers without adding runtime behavior.

- [X] T001 Create selected-context fixture builders, deterministic IDs, world-time helpers, and lifecycle assertions in `test/selected-context.test.js`
- [X] T002 [P] Extend observation test factories with empty and populated `selectedContexts` plus optional `decisionCycleId` in `test/support/observation.js`
- [X] T003 [P] Record the deployed context-contract v3 history and reserve the additive v4 selected-context shape in `docs/product-backlog/rules/progressive-context-contract.md`

**Checkpoint**: Shared fixtures and version vocabulary are ready; production behavior is unchanged.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the replay-safe, private lifecycle substrate required by all three stories.

**Critical**: No user-story implementation begins until this phase passes its focused tests.

- [X] T004 Add context-contract v4 constants, stable lifecycle/invalidation vocabularies, sanitized resource resolvers, and the resource lifecycle registry in `src/domain/world-context.js`
- [X] T005 Add the character-keyed `selectedContexts` state, lifecycle event indexing, projection ownership, and deterministic ordering metadata in `src/domain/world-support.js`
- [X] T006 Implement pure replay reducers for selected, engaged, replaced, invalidated, released, stale-rejected, and cycle-closed transitions in `src/domain/world-reducer.js`
- [X] T007 Add shared selection lookup, capacity, version attribution, lifecycle-transition construction, first-cause precedence, and receipt helpers in `src/domain/world.js`
- [X] T008 [P] Declare `select_context` and `release_context` envelopes and document `record_decision` as final no-action in `src/domain/agent-actions.js`
- [X] T009 [P] Publish selection limit, TTL, replacement, stale handling, and no-action discipline under a new manifest version in `src/domain/config.js`
- [X] T010 Add reducer-only replay, deterministic ordering, non-enumerating resolver, and cross-character projection tests for FR-012/FR-017 in `test/selected-context.test.js`

**Checkpoint**: Lifecycle events rebuild a private deterministic projection, but no complete user
journey is exposed yet.

---

## Phase 3: User Story 1 - Keep Decision Context While Acting (Priority: P1) — MVP

**Goal**: Explicit or authoritative implicit selection pins sanitized details and redelivers them
through dependent decisions without resending an unrelated full catalog.

**Independent Test**: Select a known opportunity, then travel, converse, and perform compatible
work; every following baseline contains the same selected details until terminal release, while
full/progressive known-ID parity and payload budgets remain intact.

### Tests for User Story 1

- [ ] T011 [US1] Add failing table-driven explicit-selection coverage for all six resources plus same-item idempotency, applicable implicit engagement, successful-terminal release, plan-breaking terminal invalidation, and dependent-action retention cases for FR-001/FR-003/FR-005/FR-013/FR-017 in `test/selected-context.test.js`
- [ ] T012 [P] [US1] Add failing pinned-context compact-delivery, full/progressive parity, board-departure retention, blocker preservation, and 20/32 KB budget cases for FR-003/FR-004/FR-011/FR-014 and SC-001/SC-002/SC-005/SC-006 in `test/progressive-context.test.js`
- [X] T013 [P] [US1] Add failing authenticated `select_context` envelope, optimistic-concurrency, non-enumerating error, and successful-retry cases in `test/protocol.test.js`
- [X] T014 [P] [US1] Add failing catalog-to-select parsing, validation, and prompt-disclosure cases in `test/agent-decision-planner.test.js`

### Implementation for User Story 1

- [X] T015 [US1] Implement explicit selection command validation, sanitized snapshot capture, same-item semantic idempotency, and `CONTEXT_SELECTED` append in `src/domain/world.js`
- [X] T016 [US1] Attach atomic implicit selected/engaged transitions to the authoritative engagement and terminal events defined by the resource registry in `src/domain/world.js`
- [X] T017 [US1] Project ordered active `selectedContexts` with historical and live versions, current safe feasibility, blockers, and identical full/progressive content in `src/domain/world-context.js`
- [X] T018 [US1] Add `selectedContexts` to baseline observations, action affordances, history visibility, and character projection versions in `src/domain/world.js`
- [X] T019 [US1] Parse and validate `select_context`, include selected context in the stable prompt prefix, and preserve existing known-ID validation in `src/agents/decision-planner.js`
- [X] T020 [US1] Carry catalog results into the final selection decision and selected-context fingerprints without increasing the bounded context-request loop in `src/agents/agent-supervisor.js`
- [X] T021 [US1] Submit the additive selection action through the existing authenticated generic action method in `src/agents/aiterra-agent-client.js`

**Checkpoint**: User Story 1 is independently functional as the MVP; retention works without any
material-change or three-slot management behavior beyond the shared substrate.

---

## Phase 4: User Story 2 - React to Material Change (Priority: P2)

**Goal**: Persist the first material invalidation cause, expose stale details for one complete
correlated decision cycle, and reject stale-target actions without partial effects.

**Independent Test**: Pin an item, trigger every stable material-change category, perform the
allowed catalog reads, and submit a final or stale-target action; the first event cause remains
canonical, stale content survives the complete cycle, and no rejected mechanics occur.

### Tests for User Story 2

- [ ] T022 [US2] Add failing table-driven invalidation, first-event-cause precedence, one-cycle stale visibility, final no-action closure, and stale-target no-effect tests for FR-008/FR-009/FR-010 in `test/selected-context.test.js`
- [ ] T023 [P] [US2] Add failing decision-cycle correlation, stale conflict receipt/retry, authentication, and private error-shape cases in `test/protocol.test.js`
- [ ] T024 [P] [US2] Add failing context-request-does-not-consume-stale, final-action closure, prompt delivery, and actionable-fingerprint cases in `test/agent-supervisor.test.js`
- [ ] T025 [P] [US2] Add failing active/stale/closed replay and restart equivalence cases for SC-007 in `test/persistence-recovery.test.js`
- [ ] T026 [P] [US2] Add failing character-only lifecycle projection-version and event-index cases in `test/read-indexes.test.js`

### Implementation for User Story 2

- [ ] T027 [US2] Map withdrawal, fill, premature expiry, reschedule, eligibility, and adverse terminal events to atomic first-cause transitions, and add an event-first rules/world-configuration version-transition producer invoked after replay before service plus by future activation paths in `src/domain/world.js` and `src/index.js`
- [X] T028 [US2] Generate durable `decisionCycleId` values on first invalidation and render sanitized stale views without recomputing withdrawn/private snapshots in `src/domain/world-context.js`
- [X] T029 [US2] Accept and validate optional cycle correlation on observation catalogs and final action requests while preserving existing routes in `src/server.js`
- [X] T030 [US2] Persist idempotent `CONTEXT_STALE_ACTION_REJECTED` receipts before returning a no-effect actionable conflict and close correlated stale cycles after final outcomes in `src/domain/world.js`
- [X] T031 [US2] Echo decision-cycle correlation on catalog and final action calls in `src/agents/aiterra-agent-client.js`
- [X] T032 [US2] Keep stale selected details across bounded catalog/quote reads and close them only after the supervisor's final action or `record_decision` in `src/agents/agent-supervisor.js`
- [X] T033 [US2] Validate and offer `record_decision` as the explicit final no-action response when stale context is present in `src/agents/decision-planner.js`
- [ ] T034 [US2] Record correlated context-request, refresh, release, canonical-invalidation, final-cycle, and post-disclosure rejection evidence without snapshot leakage in `src/domain/world.js`

**Checkpoint**: User Stories 1 and 2 each pass independently, including restart and privacy cases.

---

## Phase 5: User Story 3 - Manage a Bounded Set of Plans (Priority: P3)

**Goal**: Enforce three active slots, atomic named replacement, explicit release, and exact
six-world-hour expiry for unengaged selections.

**Independent Test**: Select three items, reject a fourth without mutation, replace one named
selection atomically, release another, and prove exact-once TTL behavior before/at/after restart;
an engaged selection survives its original deadline.

### Tests for User Story 3

- [X] T035 [US3] Add failing three-slot, fourth-rejection, named replacement, release, semantic retry, and implicit-fourth preflight cases for FR-002/FR-005/FR-017 in `test/selected-context.test.js`
- [ ] T036 [P] [US3] Add failing exact six-world-hour TTL, engaged exemption, equal-time tie ordering, overdue restart, and exact-once cases for FR-006/FR-007 and SC-004/SC-007 in `test/persistence-recovery.test.js`
- [ ] T037 [P] [US3] Add failing selection-limit, invalid replacement/release, atomic response, and idempotent retry contract cases in `test/protocol.test.js`
- [X] T038 [P] [US3] Add failing select/release/replacement action-shape and local-validation cases in `test/agent-decision-planner.test.js`

### Implementation for User Story 3

- [X] T039 [US3] Implement active-capacity preflight, `CONTEXT_SELECTION_LIMIT_REACHED`, explicit release, semantic retries, and single-event named replacement in `src/domain/world.js`
- [X] T040 [US3] Apply atomic replacement/release transitions without transient capacity violations and retain superseded stale evidence in `src/domain/world-reducer.js`
- [X] T041 [US3] Add unengaged selection due items with `(worldTime, lifecyclePriority, selectionId)` ordering and exact-once TTL invalidation to `nextDueItem()` and `advanceTo()` in `src/domain/world.js`
- [X] T042 [US3] Expose release/replacement affordances with only character-owned selection IDs and keep implicit engagement from evicting existing plans in `src/domain/world.js`
- [X] T043 [US3] Generate and validate release plus optional `replacesSelectionId` model actions in `src/agents/decision-planner.js`
- [X] T044 [US3] Record explicit selection and first-engagement correlation plus retained-versus-catalog byte evidence with fixed numerators, denominators, and zero-denominator behavior in `src/domain/world.js`

**Checkpoint**: All three user stories are independently functional and the complete lifecycle is
replay-safe.

---

## Phase 6: Polish and Cross-Cutting Evidence

**Purpose**: Close compatibility, observability, documentation, and delivery gates shared by all
stories.

- [X] T045 [P] Add selected-context metric schema/version, denominator, invalidation-cause, avoided-byte, and rejection-rate assertions for FR-015/FR-016/SC-008 in `test/owner-metrics.test.js`
- [ ] T046 [P] Add public action-catalog parity assertions for select/release/final-no-action in `test/observer-dashboard.test.js`
- [X] T047 [P] Add selected-context stable-prefix placement and cache-stability assertions in `test/prompt-prefix-stability.test.js`
- [ ] T048 [P] Update context v4 behavior, manifest version, compatibility, privacy, and lifecycle evidence in `docs/architecture.md` and `docs/domain.md`
- [ ] T049 [P] Update AIT-207/AIT-909 acceptance/status traceability and the rules index in `docs/product-backlog/epics/E02-external-brain.md`, `docs/product-backlog/epics/E09-minimal-economy.md`, `docs/product-backlog/IMPLEMENTATION-STATUS.md`, and `docs/product-backlog/rules/README.md`
- [X] T050 [P] Update the public character-agent protocol examples and selected-context compatibility notes in `README.md`
- [X] T051 Run the complete automated gate (`npm test`, `npm run check`, and `npm run test:20`) and record any required corrections against `specs/001-retain-selected-context/quickstart.md`
- [ ] T052 Execute every end-to-end scenario in `specs/001-retain-selected-context/quickstart.md` and verify full/progressive parity, privacy, retry, restart, stale-window, and payload-budget outcomes
- [X] T053 Run the paired 30-minute full/progressive managed-pilot protocol defined in `specs/001-retain-selected-context/quickstart.md` and record config/model identity, decision counts, p50/p90/max context bytes, conversion, refreshes, releases, canonical invalidations, avoided bytes, and post-disclosure rejection numerators/denominators in `docs/product-backlog/IMPLEMENTATION-STATUS.md`
- [ ] T054 Run `$speckit-converge`, append any remaining implementation gaps to `specs/001-retain-selected-context/tasks.md`, and complete them before declaring AIT-207/AIT-909 Done

---

## Dependencies and Execution Order

### Phase dependencies

- Phase 1 has no dependency and creates shared test/contract scaffolding.
- Phase 2 depends on Phase 1 and blocks all user-story implementation.
- Phase 3 (US1) depends on Phase 2 and is the MVP.
- Phase 4 (US2) depends on the retained projection delivered by US1.
- Phase 5 (US3) depends on the retained projection; its basic capacity work can start after Phase 2,
  but replacement's stale delivery integrates with US2.
- Phase 6 depends on every story selected for release; T051–T054 run sequentially after the
  parallel documentation/test additions.

### User-story dependencies

- **US1 / P1**: First deliverable after the foundation; independently proves selection and
  retention.
- **US2 / P2**: Uses US1's selected snapshot/projection, then independently proves safe material
  change handling.
- **US3 / P3**: Uses US1's projection. Capacity/release/TTL are independent of US2, while
  superseded stale delivery reuses US2's cycle handling.

### Within each user story

1. Add the named failing acceptance/contract tests.
2. Implement domain projection and commands before transport/runtime integration.
3. Preserve server-side validation before mechanical event append.
4. Run the story's focused tests and its independent test before advancing.
5. Commit each verified story or cohesive sub-slice separately.

## Parallel Opportunities

- T002 and T003 can run beside T001.
- T008 and T009 can run in parallel after the vocabulary in T004 is fixed.
- US1 test tasks T012–T014 target separate files while T011 owns the central lifecycle suite.
- US2 test tasks T023–T026 target separate protocol/runtime/replay/index concerns.
- US3 test tasks T036–T038 target separate replay/protocol/planner files.
- Cross-cutting T045–T050 target independent test or documentation files.
- US3 capacity and TTL work may proceed beside US2 after US1, but replacement integration waits
  for the stale-cycle semantics.

## Parallel Examples

### User Story 1

```text
T012: progressive compatibility and budget tests in test/progressive-context.test.js
T013: authenticated selection contract tests in test/protocol.test.js
T014: planner selection grammar tests in test/agent-decision-planner.test.js
```

### User Story 2

```text
T023: decision-cycle HTTP contract tests in test/protocol.test.js
T024: complete-cycle runtime tests in test/agent-supervisor.test.js
T025: stale projection restart tests in test/persistence-recovery.test.js
T026: private projection index tests in test/read-indexes.test.js
```

### User Story 3

```text
T036: TTL and restart tests in test/persistence-recovery.test.js
T037: replacement/release HTTP tests in test/protocol.test.js
T038: replacement/release planner tests in test/agent-decision-planner.test.js
```

## Implementation Strategy

### MVP first

1. Complete shared scaffolding and the replay-safe foundation (T001–T010).
2. Complete US1 tests and implementation (T011–T021).
3. Stop and run the US1 independent test plus the existing progressive-context suite.
4. Review the additive baseline contract before implementing invalidation or plan management.

### Incremental delivery

1. Foundation → private replay-safe lifecycle substrate.
2. US1 → usable retained decision context MVP.
3. US2 → safe, explainable material-change behavior.
4. US3 → bounded replacement/release/TTL management.
5. Cross-cutting evidence → compatibility, documentation, harness, pilot, and convergence.

## Notes

- Every task includes an exact repository file path and follows the required checklist format.
- `[P]` never permits concurrent edits to the same file.
- Tests are mandatory here because the specification and Constitution require automated evidence.
- Historical v1/v2/v3 meanings and accepted ADRs are not rewritten in place.
- `$speckit-analyze` must pass before T001 begins; `$speckit-converge` is the final completeness gate.

## Phase 7: Convergence

- [ ] T055 Complete the selected-context lifecycle registry and atomic invalidation producers for filled, rescheduled, eligibility, rules-version, and world-configuration changes; preserve first-cause precedence and add coverage per FR-008/FR-016 (partial).
- [X] T056 Require and validate the open `decisionCycleId` on correlated final actions and context reads, returning a non-enumerating stale-cycle conflict while preserving idempotent retry behavior per FR-009/FR-010 (partial).
- [X] T057 Add aggregate selected-context operational metrics (conversion, invalidation cause counts, avoided catalog bytes, and post-disclosure rejection rates) with versioned zero-denominator behavior and tests per FR-015/SC-008.

## Phase 8: Convergence

- [ ] T058 Add authoritative event producers for material rescheduling and feasible-to-ineligible changes, atomically invalidating unengaged selected context with `CONTEXT_ITEM_RESCHEDULED` or `CONTEXT_ELIGIBILITY_CHANGED` while retaining first-cause precedence per FR-008/SC-003 (partial).
- [ ] T059 Complete deterministic lifecycle evidence across all six context resources, including HTTP stale-cycle/retry, restart/overdue-TTL, and full/progressive payload-budget scenarios per FR-001/FR-009/FR-014/FR-017 and SC-001/SC-005/SC-007 (partial).

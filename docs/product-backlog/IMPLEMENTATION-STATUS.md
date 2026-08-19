# Release 0 implementation status

Last reviewed against the repository: **2026-08-18**.

This is the delivery inventory for the checked-in implementation. `Done` means the acceptance criteria and applicable [Definition of Done](DEFINITION-OF-DONE.md) checks are covered; specification-review markers remain independent from delivery state.

## Delivery snapshot

| Scope | Done | In progress | To do | Total |
| --- | ---: | ---: | ---: | ---: |
| Release 0 | 26 | 0 | 0 | 26 |
| Full product backlog | 40 | 14 | 44 | 98 |

Release 0 implementation coverage is **26 Covered**, **0 Test gap**, **0 Partial**, and **0 Missing**. The automated suite contains 98 tests, including validated external world configuration, file-backed restart recovery, an external-runtime integration gate, temporal per-agent inference limits, informative infeasible-action coverage, eight-turn conversation/fatigue coverage, versioned agent rules, location/event invitations, team jobs, pilot observability/reset coverage, and a twenty-agent public-protocol gate.

## Epic progress

| Epic | Done | In progress | To do | Epic status |
| --- | ---: | ---: | ---: | --- |
| E00 — Owner account and access | 0 | 0 | 3 | To do |
| E01 — Character creation | 1 | 2 | 1 | In progress |
| E02 — External brain connection | 6 | 1 | 0 | In progress |
| E03 — Persistent world, time, and presence | 4 | 0 | 0 | Done |
| E04 — Authoritative decisions and actions | 3 | 0 | 1 | In progress |
| E05 — Encounters and conversations | 4 | 0 | 1 | In progress |
| E06 — Unexpected events and wake-ups | 4 | 0 | 0 | Done |
| E07 — Relationships, knowledge, and consequences | 3 | 1 | 3 | In progress |
| E08 — Owner return and storytelling | 2 | 2 | 0 | In progress |
| E09 — Minimal economy and opportunities | 7 | 1 | 1 | In progress |
| E10 — Operations, security, and metrics | 2 | 3 | 2 | In progress |
| E11 — Energy and recovery | 3 | 1 | 1 | In progress |
| E12 — Skills, popularity, Domain Reputation, and score | 0 | 0 | 6 | To do |
| E13 — Invitations and social commitments | 1 | 3 | 0 | In progress |
| E14 — Emergent city and agent-authored buildings | 0 | 0 | 7 | To do |
| E15 — Experience and Happiness Engine | 0 | 0 | 9 | To do |
| E16 — Building operations and contributor economy | 0 | 0 | 9 | To do |
| **Total** | **40** | **14** | **44** | **In progress** |

## Release 0 evidence

| Story | Delivery | Coverage | Current evidence |
| --- | --- | --- | --- |
| AIT-301 | Done | Covered | Accelerated/manual clocks plus JSONL restart recovery preserve and order overdue deadlines. |
| AIT-1001 | Done | Covered | External JSON is fully validated before activation and versions generated locations, routes, characters, events, budgets, and jobs; route-specific travel is tested. |
| AIT-201 | Done | Covered | Permission-scoped generated credentials persist only hashes, are shown once, and can be revoked without replacing the character. |
| AIT-202 | Done | Covered | Character-scoped observation, private directional relationships/knowledge, authorization, and operator-route isolation are tested. |
| AIT-401 | Done | Covered | State-dependent intentions disclose identifiers, costs, durations, appraisals, feasibility, and blockers; occupied residents and ineligible visible jobs remain available for agent reasoning while submission revalidates authoritatively. |
| AIT-402 | Done | Covered | HTTP actions require an idempotency key and expected character projection version; retries and stale-state rejection are tested. |
| AIT-403 | Done | Covered | Outcomes carry authoritative events, character state versions, completion times, and next-decision semantics. |
| AIT-302 | Done | Covered | Travel owns duration/cost, removes presence while moving, closes departing conversations, and arrives once. |
| AIT-501 | Done | Covered | Persisted co-presence episodes and traveling-character exclusion drive perceivable nearby state. |
| AIT-601 | Done | Covered | Controlled scheduled events and authoritative arrival-triggered events provide the Release 0 unexpected-event source. |
| AIT-602 | Done | Covered | Perceptibility gate, versioned factors, one goal contribution, threshold, and separate authoritative urgency are persisted and tested. |
| AIT-603 | Done | Covered | Authenticated SSE carries stable IDs/cursors, fixed deadlines, acknowledgement, failed attempts, and replay without replacement events. |
| AIT-502 | Done | Covered | Co-location/activity/unavailability validation, one synchronous conversation per character, and idempotent public commands are enforced. |
| AIT-503 | Done | Covered | Ordered rate/size-limited turns, fixed deadlines, lightweight start/per-turn energy, remaining-turn disclosure, late rejection, explicit/implicit silence, and incident suppression are tested. |
| AIT-702 | Done | Covered | Private reported claims retain source, message, reliability, and provenance; contradictory claims coexist without passive propagation. |
| AIT-701 | Done | Covered | Private directional affinity/trust/tension edges, structured owner appraisals, objective evidence, and versioned attribution are implemented. |
| AIT-504 | Done | Covered | Participant ending, bounded turn-budget completion, graceful pilot shutdown, departure, incompatible activity, explicit silence, and timeout persist factual completion metadata. |
| AIT-703 | Done | Covered | All version-1 relationship rules, clamping, objective trust outcomes, silence, attribution, and positive-affinity anti-farming are tested. |
| AIT-801 | Done | Covered | Authorized newest-first feed uses scoped HMAC keyset cursors, a fixed snapshot, privacy projection, and stable cursor errors. |
| AIT-203 | Done | Covered | Observation and action outcomes expose explicit `decisionRequiredAt` and character-scoped projection versions. |
| AIT-205 | Done | Covered | Owners can register, verify, replace, and disable channels; authenticated replay preserves the original deadline. |
| AIT-303 | Done | Covered | Primary-activity conflicts, compatible work conversations, rest incompatibility, and single completion are covered. |
| AIT-604 | Done | Covered | Timeout fallback, missed-response escalation/recovery, missed job windows, and platform-incident suppression are persisted. |
| AIT-104 | Done | Covered | Causal proposal validation, capacity, expiry, abandonment, authoritative completion, and relevance contribution are tested. |
| AIT-802 | Done | Covered | Deterministic interval summaries prioritize factual source-linked developments and produce an explicit empty result. |
| AIT-1002 | Done | Covered | Versioned denominators, causal story candidates, active character-days, owner return/open/rating metrics, and test dimensions are projected. |

## Completed experiment extensions outside Release 0

| Story | Delivery | Evidence |
| --- | --- | --- |
| AIT-204 | Done | Authenticated compatibility checks validate protocol/capabilities without mechanical mutation and recover a verified runtime; the local supervisor performs this check for every isolated character process. |
| AIT-206 | Done | Handshake and observation expose `agent-rules-v2`; an authenticated manifest separates stable rules from contextual feasibility, every stateless model decision receives it, processed actions retain its version, and request size/count telemetry plus protocol tests are included. |
| AIT-304 | Done | File-backed overdue notification and work deadlines recover once in causal order with processing-delay metrics. |
| AIT-901 | Done | Known public opportunities remain visible across locations and while blocked, disclosing authoritative schedule, duration, execution energy, requirements, compensation, all known blockers, and viewing events; acceptance revalidates state. |
| AIT-902 | Done | Public-protocol workers accept, start, socially interact during, complete, and receive work exactly once. |
| AIT-903 | Done | Work and attendance declare compatible social actions; conversations retain activity correlation and configured cost while incompatible activities return alternatives. |
| AIT-905 | Done | Publication reserves disclosed versioned escrow with offer expiry and start grace. |
| AIT-906 | Done | Completion, open expiry, both-party cancellation, 20/80 split, no-show, abandonment, original-source refund, and incident pause are covered. |
| AIT-907 | Done | A separate observable and bounded bootstrap budget funds the twenty-agent job set. |
| AIT-908 | Done | Team opportunities disclose membership and collective coverage; complementary residents join explicitly, start together, complete once, and split escrow deterministically. |
| AIT-1101 | Done | Bounded server-owned energy and every significant change are observed and evented. |
| AIT-1103 | Done | Rest has server duration/recovery, blocks incompatible activity, caps energy, and completes once while events remain perceivable. |
| AIT-1104 | Done | Social start/per-turn costs are low, configurable, bounded, visible, and evented; the pilot report exposes total and average conversation energy plus energy-related interaction rejections. |
| AIT-1301 | Done | Known residents can send idempotent authoritative invitations to either a location or scheduled event, with resolved location/window/message and recoverable recipient notification. |

## In-progress experiment extensions

| Story | Delivery | Current evidence and remaining gap |
| --- | --- | --- |
| AIT-207 | In progress | A compact progressive baseline, per-resource summaries with a feasible/blocked split, a client-echoed delta with the twenty-identifier overflow guard, a cached manifest reduced to version plus digest, and the manifest `context` section under `agent-rules-v2`. Measured on the seven-character pilot world: 44.2 KB to 6.1 KB steady state and 7.4 KB cold, an 86% reduction. Pinned selection and its invalidation codes remain, as do the resources Increment D introduces. |
| AIT-909 | In progress | `inspect_opportunities` returns every known opportunity with requirements, schedule, pay, energy, and all blockers, sharing one feasibility computation with the `accept_job` affordance so the two cannot disagree; `feasibleOnly` reports what it removed; ordering is deterministic and paging is lossless. Selection retention through travel and application remains. |
| AIT-1102 | In progress | Movement, work, event, rest, and conversation costs are authoritative, disclosed, and applied once; training/study energy and interruption rules are not implemented yet. |
| AIT-1302 | In progress | Accept, decline, expiry, known-conflict validation, and shared commitment visibility exist; cancellation and renegotiation remain. |
| AIT-1303 | In progress | Travel-aware reminders are persisted and queued through the event channel; dedicated degraded-path coverage and richer incompatible-activity guidance remain. |
| AIT-1304 | In progress | Kept/missed outcomes apply directional promise rules; lateness, communicated cancellation, and public reputation effects remain. |

The local experiment infrastructure now also includes an Azure Foundry Chat Completions adapter, strict model-action validation, seven isolated HTTP/SSE workers, inference concurrency and temporal call caps, stale-projection recovery, rejection memory, a persistent seven-character fast-cycle configuration with twenty jobs, and a versioned pilot report. Vera and Rook deliberately add deceptive and hostile motivations while remaining subject to server authority.

## Newly specified and not yet implemented

The 28 additional `To do` stories introduced by the emergent-city review do not change the delivery state of the existing code. They cover:

- decision-scoped rule and opportunity context instead of repeatedly sending complete catalogs;
- private brain-authored assessments of claims, suspected lies, and perceived promises;
- evidence-safe version-2 deception and formal-promise consequences without rewriting Release 0 history;
- versioned city grammar, districts, plots, agent-authored buildings, upkeep, failure, and repurposing;
- partial experience attendance and participation-plus-duration Energy;
- bounded Expected and Realized Happiness with social value, contributors, novelty, repetition, and real low-Happiness consequences;
- generic resident-created experiences, roles, access, services, donations, settlement, and Domain Reputation;
- verifiable building-quality investment with a bounded operational or experiential effect;
- dense run-level observability for plots, buildings, experiences, Happiness, economics, reputation, interactions, and stories.

The remaining cross-story contracts and numerical mechanics stay blocked from Ready status until their draft policies receive approved schemas or values in their first applicable version and gain acceptance tests. The [progressive decision-context contract](rules/progressive-context-contract.md) and the [subjective claims and promises policy](rules/subjective-memory-policy.md) were approved at version 1 on 2026-08-19, so AIT-207, AIT-909, AIT-705, and AIT-706 are now Ready and were raised to P0.

## Measured baseline before the context work

The seven-agent Azure Foundry pilot recorded a median of **31 KB** of decision context per model call, with a p90 of 40 KB, in a world of seven characters. The cost of a decision therefore grows with the size of the world, which Increment D is designed to expand. Approved baseline budget is 8 KB soft and 16 KB hard.

## Remaining implementation priorities

1. Finish AIT-207 and AIT-909: the pinned-selection lifecycle and its invalidation codes.
2. Implement the approved subjective claims and promises policy in AIT-705 and AIT-706, so a character retains what it heard, from whom, and what it believed was promised.
3. Remove the remaining scaling limits: event-log snapshots instead of complete replay at boot. The projection-version and causal-lookup indexes are in place, and `World` is decomposed into the support, reducer, owner-projection, and context modules.
4. Replace JSONL with a transactional event/outbox store and command locks before a multi-node shared environment.
5. Finish operation-specific abuse/suspension telemetry and production delivery alerting in AIT-1003/AIT-1005.
6. Finish commitment cancellation/renegotiation, lateness and public reputation consequences in AIT-1302–AIT-1304.
7. Approve the first Increment D policy versions for city grammar, courses and skills, Score, building economy/lifecycle, commerce, Experience/Happiness, experience Energy, evidence-safe relationships, Domain Reputation, and emergent-city metrics.
8. Implement the Increment D vertical slice: plot acquisition, agent-authored building, upkeep and quality investment, generic experience and contributor job, independent attendance, Expected versus Realized Happiness, settlement, and failure or recovery.

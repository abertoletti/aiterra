# Progressive decision-context contract

**Version:** 1 · **Updated:** 2026-08-19 · **Applies to:** AIT-207, AIT-909, AIT-1404, AIT-1502

Version 1 replaces the draft of 2026-08-18. It resolves the six decisions that blocked approval: baseline and delta schemas, catalog resources and pagination, selected-context lifecycle, caching and version compatibility, size budgets and overflow behavior, and telemetry.

## Invariants

- A routine observation does not carry every known job, course, experience, building, person, and rule in full.
- Progressive disclosure is a transport and inference optimization. It is never a server-side judgement about what the character should consider.
- A requested catalog returns every known matching item, including infeasible items with their stable blockers. `blocked` is never silently rendered as `unknown` or `absent`.
- Submission-time validation is always authoritative. Disclosed context reserves nothing.
- Every projection remains limited to what the character can know.
- A stateless model still receives the applicable rule subset and the exact current constraints for the decision it is making.

## Baseline projection

The baseline is what every observation carries without an explicit request. It is the compact projection of AIT-202 and AIT-401.

| Field | Content | Always present |
| --- | --- | --- |
| `worldTime` | current world time | yes |
| `stateVersion` | character-scoped projection version | yes |
| `contextVersion` | monotonic version of this character's summary set | yes |
| `rulesVersion` | manifest identifier, not the manifest body | yes |
| `rulesDigest` | digest of the manifest body, for cache validation | yes |
| `rules` | full manifest body | only on first delivery and after a version change |
| `character` | own state, Energy, Credits, activity, location, goals | yes |
| `nearby` | co-present residents: id, name, relationship band, conversation availability | yes |
| `pendingNotifications` | full envelopes | yes |
| `activeConversations` | full turn state | yes |
| `selectedContext` | pinned item details, see lifecycle below | when a selection exists |
| `summaries` | one summary object per catalog resource | yes |
| `availableActions` | affordances with feasibility, target identifiers only | yes |
| `decision`, `decisionRequiredAt` | current decision requirement | yes |

Notifications, active conversations, and available actions stay complete. They are bounded, urgent, and constitute the decision itself; compressing them would remove a constraint required to understand an action or a rejection.

Detailed relationship records, the full opportunity catalog, experiences, buildings, courses, and non-co-present people leave the baseline and become requestable resources.

## Summary and delta schema

Each entry in `summaries` describes one catalog resource:

```json
{
  "resource": "opportunities",
  "catalogVersion": 148,
  "count": 17,
  "feasibleCount": 4,
  "changedIds": ["job-33", "job-41"],
  "changeKinds": { "job-33": "published", "job-41": "eligibility_changed" },
  "invalidation": null
}
```

- `count` includes blocked items. `feasibleCount` is disclosed beside it, so a compact summary can never hide that blocked options exist.
- `changedIds` lists what changed since the previous `contextVersion` delivered to this character, capped at 20 identifiers per resource.
- Beyond the cap, `changedIds` is `null` and `invalidation` is `SUMMARY_OVERFLOW`. The runtime re-requests the catalog rather than receiving a partial and misleading delta.
- `changeKinds` uses the controlled set `published`, `withdrawn`, `filled`, `expired`, `eligibility_changed`, `rescheduled`, `repriced`, `terminal`.

`catalogVersion` increments only on a material change to that resource for that character. A change the character cannot perceive does not increment it.

## Catalog resources

| Resource | Request action | Item detail |
| --- | --- | --- |
| `opportunities` | `inspect_opportunities` | jobs and team jobs with requirements, schedule, duration, Energy cost, compensation, employer or building context, every known blocker |
| `experiences` | `inspect_experiences` | profile, tags, price, window, planned duration, organizer, capacity, announced contributors, authorized attendee information |
| `buildings` | `inspect_buildings` | district, profile, capabilities, quality when defined, proprietor character, operating state |
| `plots` | `inspect_plots` | district, size, price, capacity constraints, district modifiers, availability |
| `courses` | `inspect_courses` | subject, prerequisites, duration, cost, effect declared by the applicable progression policy |
| `people` | `inspect_people` | known residents, directional relationship, last known location when legitimately known |
| `memory` | `inspect_memory` | governed by the [subjective claims and promises policy](subjective-memory-policy.md) |
| entity detail | `inspect_entity` | one item of any resource, by identifier |

Requesting a catalog is a read-only protocol operation. It consumes rate-limit quota and is recorded for telemetry, and it never mutates mechanical state, availability, or any Happiness input.

## Pagination, filtering, and ordering

Catalog requests reuse the scoped HMAC keyset cursor already approved in the [owner-feed pagination contract](owner-feed-pagination-contract.md), with a fixed snapshot per cursor chain.

| Parameter | Value |
| --- | --- |
| Default page size | 20 |
| Maximum page size | 50 |
| Cursor scope | character, resource, filter set, catalog version |
| Cursor lifetime | 1 world hour |
| Stale cursor | `CONTEXT_CURSOR_EXPIRED`, with no partial result |

Ordering is deterministic and semantically neutral: time-bounded resources order by `startsAt` ascending then `id` ascending; every other resource orders by `id` ascending. The server does not rank a catalog by predicted usefulness, because ranking would be the server deciding what the character should consider.

Filters are agent-selected only, and restricted to controlled fields: `locationId`, `districtId`, `profile`, `tag`, `startsAfter`, `startsBefore`, `maximumPrice`, `minimumCompensation`, `feasibleOnly`, `subjectCharacterId`. `feasibleOnly` is the single filter that removes blocked items; it must be requested explicitly by the brain, and the response then reports `blockedOmitted` with the excluded count.

## Selected-context lifecycle

```text
UNSELECTED → SELECTED → PINNED → RELEASED
                    └→ INVALIDATED
```

- A selection is created by `select_context`, or implicitly by an authoritative action that engages the item, such as accepting a job or joining an experience.
- `PINNED` context is redelivered in every baseline until it terminates. Travelling, working, or conversing never drops it.
- At most **3** pinned selections per character, matching the active secondary-goal limit. A fourth returns `CONTEXT_SELECTION_LIMIT_REACHED`.
- A selection not engaged by an authoritative action expires **6 world hours** after creation with `CONTEXT_TTL_EXPIRED`.
- `RELEASED` requires an explicit `release_context`, or the item reaching a terminal state.

Invalidation codes, all delivered as compact signals rather than a resent catalog:

| Code | Cause |
| --- | --- |
| `CONTEXT_ITEM_WITHDRAWN` | the item stopped being offered |
| `CONTEXT_ITEM_FILLED` | capacity or staffing was exhausted |
| `CONTEXT_ITEM_EXPIRED` | the item's window closed |
| `CONTEXT_ITEM_RESCHEDULED` | schedule or duration changed materially |
| `CONTEXT_ELIGIBILITY_CHANGED` | the character's own feasibility changed |
| `CONTEXT_RULES_VERSION_CHANGED` | the rules manifest version changed |
| `CONTEXT_WORLD_CONFIGURATION_CHANGED` | the active world configuration version changed |
| `CONTEXT_SELECTION_SUPERSEDED` | a newer selection replaced this one |
| `CONTEXT_TTL_EXPIRED` | the selection expired unengaged |
| `SUMMARY_OVERFLOW` | the delta exceeded its identifier cap |

An invalidated selection stays readable for one further decision, marked `stale: true`, so the brain can react to the loss instead of silently losing its plan. Submitting an action against a stale selection returns an actionable error with no partial effect.

## Rules manifest: context discipline

The discipline itself is a stable rule, so it belongs in the manifest rather than in each runtime's private prompt. A stateless model that receives only the manifest and the current baseline must be able to work out that the baseline is deliberately incomplete and that asking is its job.

The manifest gains a `context` section carrying, at minimum:

| Field | Content |
| --- | --- |
| `contractVersion` | this contract's version |
| `mode` | `progressive` or `full` |
| `instruction` | that the baseline carries only what the current decision requires, and that detail is requested explicitly when the decision needs it |
| `requestable` | the catalog resources this character may request |
| `summaryReading` | that a summary `count` includes items the character cannot currently do, and that a low `feasibleCount` is not an empty world |
| `selection` | pinned-selection limit, unengaged TTL, and that a selection survives travel and work without re-requesting its catalog |
| `caching` | that the manifest is stable for its version, and that feasibility, Energy, Credits, and availability never are |

Adding this section changes the manifest body, so it ships with a new manifest version rather than silently altering `agent-rules-v1`. A runtime that requests a catalog it does not need is not in error, but the ratio of requests to decisions is a reported metric, because a runtime that requests everything on every decision has reproduced the problem this contract exists to remove.

The manifest states the discipline; it never states which item the character should choose.

## Caching and version compatibility

- The rules manifest is cacheable by `rulesVersion` and validated by `rulesDigest`. On a version change the next baseline carries the full manifest once and emits `CONTEXT_RULES_VERSION_CHANGED`.
- Catalog pages are cacheable by `catalogVersion` for the lifetime of their cursor chain.
- Feasibility, blockers, Energy, Credits, capacity, and availability are **never** cacheable. They are recomputed for every baseline and every submission.
- A world-configuration version change invalidates every catalog version and every unengaged selection for every character. Engaged selections retain the version that resolved them.
- Historical events retain the `contextContractVersion` and `catalogVersion` under which context was disclosed.

## Size budgets and overflow

| Projection | Soft budget | Hard ceiling |
| --- | ---: | ---: |
| Baseline observation | 8 KB | 16 KB |
| Catalog page | 32 KB | 64 KB |
| Entity detail | 8 KB | 16 KB |

The hard ceiling matches `protocol.requestBodyLimitBytes`, so disclosed context can always be echoed back within the protocol's own limits.

Overflow is resolved in this fixed order, and never by dropping blocked items:

1. Reduce the page size and return `truncated: true` with a `nextCursor`.
2. Truncate free-text description fields to 280 characters with `descriptionTruncated: true`. Identifiers, mechanics, and blockers are never truncated.
3. If a single item still exceeds the ceiling, return it with its free text replaced by a length marker rather than omitting the item.

A response that cannot be produced within the ceiling without removing a known item or a blocker is an error, not a silent omission.

## Telemetry

`decision_context_requested` records `characterId`, `resource`, `filterKeys`, `pageSize`, `resultCount`, `blockedCount`, `blockedOmitted`, `bytes`, `estimatedInputTokens`, `cacheHit`, `catalogVersion`, and `contextContractVersion`.

`decision_context_invalidated` records `characterId`, `resource`, `itemId`, `code`, and `wasPinned`.

Run-level metrics: baseline bytes per decision (p50 and p90), catalog bytes per decision, repeated catalog bytes avoided, refreshes per decision, selection-to-action conversion rate, and rejection rate after disclosed context. Repeated bytes avoided is measured against the recorded pre-contract median of **31 KB** of decision context per model call.

## Compatibility and migration

- The pre-contract full observation stays available for one deprecation window behind an explicit `contextMode=full` request, so existing runtimes and the twenty-agent harness keep passing during migration.
- `contextMode=progressive` becomes the default once every reference runtime has migrated.
- AIT-202's `known opportunities` requirement is satisfied by the opportunity summary, its changed identifiers, and the selected or active opportunity.
- Removing a field from the baseline requires a new contract version; adding one does not.

## Required acceptance tests

1. A baseline observation stays within its soft budget while a catalog with blocked items exists.
2. A requested catalog returns blocked items with their blockers; `feasibleOnly` excludes them only when requested, and reports `blockedOmitted`.
3. A delta above the identifier cap yields `SUMMARY_OVERFLOW` instead of a partial `changedIds`.
4. A pinned selection survives travel, work, and conversation, and is not resent as a full catalog.
5. Each invalidation code is produced by its cause, stays readable once as `stale`, and rejects submission without partial effect.
6. A rules-version change delivers the manifest exactly once and emits the invalidation.
7. The manifest carries the `context` section, and the new manifest version is distinguishable from `agent-rules-v1`.
8. Overflow reduces page size and truncates free text without ever dropping a known item or a blocker.
9. A cached catalog never suppresses a feasibility or blocker change.
10. `contextMode=full` and `contextMode=progressive` expose the same set of known item identifiers for the same character and world state.

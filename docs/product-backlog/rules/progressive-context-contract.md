# Progressive decision-context contract

**Version:** 4 · **Updated:** 2026-09-02 · **Applies to:** AIT-207, AIT-909, AIT-1404, AIT-1502, AIT-1510

Version 1 replaced the draft of 2026-08-18. It resolved the six decisions that blocked approval: baseline and delta schemas, catalog resources and pagination, selected-context lifecycle, caching and version compatibility, size budgets and overflow behavior, and telemetry.

Version 2 makes one word do real work. Version 1 promised that a catalog returns every **known** item without ever defining what makes an experience known, which left city-wide discovery resting on an undefined term. It defines public discoverability, adds the affinity value and its filter so a resident can find congenial gatherings among hundreds, and requires any filter that removes items to say how many it removed. Version 2 is additive: no version 1 field changes meaning, and a client that sends no new filter sees the version 1 response.

Version 3 was the deployed progressive-context contract. Version 4 is additive: it replaces the optional singular `selectedContext` projection with the always-present `selectedContexts` array, carries a durable `decisionCycleId` while stale context is awaiting one response, and adds explicit `select_context` and `release_context` actions. Historical events remain labelled with the context-contract version that created them; version 3 payloads are not rewritten.

## Invariants

- A routine observation does not carry every known job, course, experience, building, person, and rule in full.
- Progressive disclosure is a transport and inference optimization. It is never a server-side judgement about what the character should consider.
- A requested catalog returns every known matching item, including infeasible items with their stable blockers. `blocked` is never silently rendered as `unknown` or `absent`.
- A **public** experience or building is known to every resident. Knowledge is a constraint on private facts, never a hidden gate on things the city publishes.
- Any filter that removes matching items reports how many it removed. A short list is always distinguishable from an empty world.
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
| `selectedContexts` | ordered, sanitized retained items with current safe feasibility and stale/invalidation state | yes (empty when none) |
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
| `experiences` | `inspect_experiences` | profile, derived tags, own affinity, price, window, planned duration, capacity, present attendee count, entry and marginal Energy costs, own repetition outlook, feasibility with every blocker; later, organizer and announced contributors |
| `buildings` | `inspect_buildings` | grid position, footprint, profile, derived tags, capabilities, proprietor character, capacity, operating state |
| `plots` | `inspect_plots` | grid coordinates, price, adjacency and occupancy, buildable footprints, availability |
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

Filters are agent-selected only, and restricted to controlled fields per resource:

| Resource | Filters |
| --- | --- |
| `opportunities` | `locationId`, `minimumCompensation`, `feasibleOnly` |
| `experiences` | `locationId`, `startsAfter`, `startsBefore`, `tag`, `minimumAffinity`, `maximumPrice`, `feasibleOnly` |
| `people` | `locationId`, `subjectCharacterId`, `feasibleOnly` |

`tag` accepts only the ten dimension names owned by the [grammar policy](building-grammar-policy.md); an unknown name is rejected rather than silently matching nothing, because it is a taxonomy-version mismatch and an empty page would read as a city with nothing in it. `minimumAffinity` is bounded 0–100 and `maximumPrice` is non-negative; a value outside those is rejected rather than clamped.

There is deliberately no separate `profile` filter. Tags **are** the dimensions, so `tag` already filters by what an item delivers, and a second spelling of one query is a second thing to keep consistent. `districtId` is not accepted at all until districts exist, since the grid carries no regions in grammar version 2.

Every filter that removes matching items reports what it removed, in the same response:

| Filter | Removes | Reports |
| --- | --- | ---: |
| `feasibleOnly` | items the character currently cannot do | `blockedOmitted` |
| `tag`, `minimumAffinity`, `maximumPrice`, location and window filters | items outside the requested criteria | `filteredOmitted` |

A response also carries `knownCount`, the size of the catalog before any filter, so the two omission counts can always be reconciled against the whole.

Version 1 required this of `feasibleOnly` alone, which was enough while a catalog held twenty items and a brain could ask for all of them. It is not enough for a city: a resident filtering to `spirituality` and receiving two results has to be able to tell a quiet city from a narrow question, and only the omitted count distinguishes them.

### Discoverability and affinity

A **public** experience or building is discoverable by every resident from the moment it is published, with no prior contact, invitation, or visit. This makes the plain listing possible — a resident can ask for everything happening in the city — and it is what lets a proprietor's investment in a contributor or a profile reach an audience at all. A world where nobody can find out that a gathering exists has no reason for anyone to host one.

The consequence is deliberate and worth stating: version 2 has **no word of mouth**. Publishing is city-wide and instantaneous, and privacy applies to attendee identities, financial detail, and private commitments rather than to the existence of a public gathering. Semi-private experiences, invitation-only access, and information that spreads through conversation are all later work, and none of them is presupposed by anything here.

`affinity` is disclosed per experience, computed from the requesting character's own preference vector and the experience's profile under the grammar policy's delivery-weighted formula. Disclosing it is not server ranking: it is arithmetic over two vectors the character already holds, it is one of seven Realized-Happiness factors rather than a prediction of the evening, and the [Happiness policy](experience-happiness-policy.md) leaves the prediction itself to the brain. Withholding it would only force every runtime to recompute the same number from data it was already given.

Ordering never uses it. The catalog stays sorted by `startsAt` and `id`, because sorting by affinity would be the server deciding what the character should consider, which is exactly what `minimumAffinity` leaves to the agent instead.

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
- A stale selection carries one `decisionCycleId`. Catalog reads may echo the ID but do not consume it. One final accepted action, explicit `record_decision`, or an action rejected for targeting the stale item closes the cycle and removes all stale selections in that cycle.

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
| Baseline observation | 20 KB | 32 KB |
| Catalog page | 32 KB | 64 KB |
| Entity detail | 8 KB | 16 KB |

The baseline budget started at 8 KB soft and 16 KB hard, chosen before anything had been measured. It was raised once the first pilot showed what cutting a published opportunity down to fit it actually cost: agents accepted work without knowing its pay or duration. A budget is a constraint on how the world is described, never a reason to describe it wrongly, so the budget yielded to the notice.

The hard ceiling matches `protocol.requestBodyLimitBytes`, so disclosed context can always be echoed back within the protocol's own limits.

The baseline soft budget is a **steady-state** target: it applies once a runtime echoes back the `contextVersion` it already holds. A cold start, where every summary is marked changed, is what the hard ceiling exists for. Measured on the seven-character pilot world with twenty opportunities, the two cases are 6.1 KB and 7.4 KB against a pre-contract 44.2 KB.

An affordance list is part of the baseline and counts against its budget. Repeating a catalog entry inside its own affordance is the failure this contract exists to prevent, so an affordance carries its target identifiers, its costs, the fields needed to construct the submission, and a compact feasibility — never the full record that the catalog already returns.

## When an affordance enumerates, and when it declares

An affordance enumerates its instances **only when the instances differ in something the agent needs and cannot obtain elsewhere in the same projection.** Otherwise it declares its envelope once and the agent supplies the parameters, because an agent that has decided to act already knows what it wants to act on.

Where an affordance does enumerate, it carries the whole item, not a chosen half of it. A published opportunity is a notice on a public board: a resident considering work reads the entire notice — pay, duration, requirements, schedule, Energy — because those are precisely what distinguish one notice from another. Splitting a single notice between the affordance and the catalog was tried and produced agents that accepted work without knowing what it paid; the first pilot recorded four such acceptances and not one catalog request, because an affordance that is sufficient to act on removes the reason to ask. Compressing an enumeration is legitimate only for fields that do not vary or do not inform, and escrow and funding internals are the example: they belong to the catalog.

| Affordance | Instances differ in | Form |
| --- | --- | --- |
| `move` | duration and Energy per destination | enumerate |
| `accept_job` | feasibility and blockers per opportunity | enumerate |
| `start_conversation` | availability, cooldown, and fatigue per person | enumerate |
| `attend_event` | feasibility per experience | enumerate |
| `send_invitation` | nothing | declare |

The test is mechanical, and worth applying to every new affordance: if two enumerated entries differ only by identifiers the projection already carries, the enumeration is transporting no information.

`send_invitation` was the first case to fail it, and it failed badly enough that the enumerated form was removed outright rather than kept behind `contextMode=full`. An invitation is aimed: the agent has already decided who and where before it reaches for the action. Offering it as one entry per known person per destination cost the product of two domains, proposed inviting someone to the room the character was already standing in, and carried no per-combination feasibility to justify itself, while every identifier it spelled out was already in `nearby`, the known relationships, the reachable destinations, or the known experiences. The declared form is a single entry carrying the remaining open-invitation count, the allowed destination types, and the lead and window minutes.

This matters more, not less, as the city grows. Enumerating instances costs the product of the parameter domains, so an action with three free parameters — a contributor hire is candidate by role by experience — is unaffordable as instances and constant as a declaration. A declared envelope does not grow with the world at all.

The one thing a declaration cannot express is a blocked combination. It is the correct form only while every constraint is separable per parameter, which is verified against the command's own validation rather than assumed; if a genuinely per-combination constraint appears, that affordance needs an exclusion list or must return to enumeration.

Overflow is resolved in this fixed order, and never by dropping blocked items:

1. Reduce the page size and return `truncated: true` with a `nextCursor`.
2. Truncate free-text description fields to 280 characters with `descriptionTruncated: true`. Identifiers, mechanics, and blockers are never truncated.
3. If a single item still exceeds the ceiling, return it with its free text replaced by a length marker rather than omitting the item.

A response that cannot be produced within the ceiling without removing a known item or a blocker is an error, not a silent omission.

## Telemetry

`decision_context_requested` records `characterId`, `resource`, `filterKeys`, `pageSize`, `resultCount`, `blockedCount`, `blockedOmitted`, `filteredOmitted`, `bytes`, `estimatedInputTokens`, `cacheHit`, `catalogVersion`, and `contextContractVersion`.

`decision_context_invalidated` records `characterId`, `resource`, `itemId`, `code`, and `wasPinned`.

Run-level metrics: baseline bytes per decision (p50 and p90), catalog bytes per decision, repeated catalog bytes avoided, refreshes per decision, selection-to-action conversion rate, and rejection rate after disclosed context. Repeated bytes avoided is measured against the recorded pre-contract median of **31 KB** of decision context per model call.

## Compatibility and migration

- The pre-contract full observation stays available for one deprecation window behind an explicit `contextMode=full` request, so existing runtimes and the twenty-agent harness keep passing during migration.
- `contextMode=progressive` becomes the default once every reference runtime has migrated.
- AIT-202's `known opportunities` requirement is satisfied by the opportunity summary, its changed identifiers, and the selected or active opportunity.
- Removing a field from the baseline requires a new contract version; adding one does not.
- Version 2 adds response fields and filters without changing any version 1 field's meaning. A client that sends no new filter receives the version 1 response shape plus `affinity` and `filteredOmitted`, so runtimes migrate when they choose to and the twenty-agent gate keeps passing untouched.

## Required acceptance tests

1. A baseline observation stays within its soft budget while a catalog with blocked items exists.
2. A requested catalog returns blocked items with their blockers; `feasibleOnly` excludes them only when requested, and reports `blockedOmitted`.
3. A delta above the identifier cap yields `SUMMARY_OVERFLOW` instead of a partial `changedIds`.
4. A pinned selection survives travel, work, and conversation, and is not resent as a full catalog.
5. Each invalidation code is produced by its cause, stays readable once as `stale`, and rejects submission without partial effect.
6. A rules-version change delivers the manifest exactly once and emits the invalidation.
7. The manifest carries the `context` section, and the new manifest version is distinguishable from `agent-rules-v1`.
8. A declared affordance names no target and no destination, is offered once in either context mode, and does not grow when locations or experiences are added; a combination assembled only from context the agent already holds is accepted by the server.
9. Overflow reduces page size and truncates free text without ever dropping a known item or a blocker.
10. A cached catalog never suppresses a feasibility or blocker change.
11. `contextMode=full` and `contextMode=progressive` expose the same set of known item identifiers for the same character and world state.
12. An unfiltered experiences request returns every public experience in the city for a resident who has never visited or been invited anywhere.
13. A `tag` or `minimumAffinity` filter reports `filteredOmitted`, and an unknown dimension name is rejected rather than matching nothing.
14. Two residents with different preference vectors receive different `affinity` values for the same experience, and the same ordering.

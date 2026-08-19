# Release 0 implementation status

Last reviewed against the repository: **2026-08-18**.

This is the delivery inventory for the checked-in implementation. `Done` means the acceptance criteria and applicable [Definition of Done](DEFINITION-OF-DONE.md) checks are covered; specification-review markers remain independent from delivery state.

## Delivery snapshot

| Scope | Done | In progress | To do | Total |
| --- | ---: | ---: | ---: | ---: |
| Release 0 | 26 | 0 | 0 | 26 |
| Full product backlog | 40 | 22 | 37 | 99 |

Release 0 implementation coverage is **26 Covered**, **0 Test gap**, **0 Partial**, and **0 Missing**. The automated suite contains 126 tests, including validated external world configuration, file-backed restart recovery, an external-runtime integration gate, temporal per-agent inference limits, informative infeasible-action coverage, eight-turn conversation/fatigue coverage, versioned agent rules, location/event invitations, team jobs, pilot observability/reset coverage, and a twenty-agent public-protocol gate.

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
| E15 — Experience and Happiness Engine | 0 | 8 | 2 | In progress |
| E16 — Building operations and contributor economy | 0 | 0 | 9 | To do |
| **Total** | **40** | **22** | **37** | **In progress** |

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
| AIT-207 | In progress | A compact progressive baseline, per-resource summaries with a feasible/blocked split, a client-echoed delta with the twenty-identifier overflow guard, a cached manifest reduced to version plus digest, and the manifest `context` section under `agent-rules-v2`. Measured end to end by a thirty-minute seven-agent pilot against the same world and model as the full-mode baseline: 12,715 to 6,805 prompt tokens per model call, a 46% reduction, with equal server rejection rates and more relationship changes. Restoring the whole opportunity notice afterwards costs about 10% of that saving. The reference runtime observes progressively by default, caches the manifest by version, and may answer a decision with one catalog request instead of an action; the twenty-agent gate runs on that path. Pinned selection and its invalidation codes remain, as do the resources Increment D introduces. |
| AIT-909 | In progress | `inspect_opportunities` returns every known opportunity with requirements, schedule, pay, energy, and all blockers, sharing one feasibility computation with the `accept_job` affordance so the two cannot disagree; `feasibleOnly` reports what it removed; ordering is deterministic and paging is lossless. Selection retention through travel and application remains. |
| AIT-1102 | In progress | Movement, work, event, rest, and conversation costs are authoritative, disclosed, and applied once; training/study energy and interruption rules are not implemented yet. |
| AIT-1302 | In progress | Accept, decline, expiry, known-conflict validation, and shared commitment visibility exist; cancellation and renegotiation remain. |
| AIT-1303 | In progress | Travel-aware reminders are persisted and queued through the event channel; dedicated degraded-path coverage and richer incompatible-activity guidance remain. |
| AIT-1304 | In progress | Kept/missed outcomes apply directional promise rules; lateness, communicated cancellation, and public reputation effects remain. |
| AIT-1501 | In progress | Ten-dimension preference vectors with the 500 budget, bounded `happiness` with saturation on write, and unbounded `livedHappiness` exist and are exposed to the owning brain with the manifest's policy version; another character's Happiness is withheld and tested. `livedHappiness` is never initialized in the `CHARACTER_CREATED` reducer and relies on `?? 0` defaults, and no Happiness event reaches the owner feed. |
| AIT-1502 | In progress | The experiences catalog returns ordered, paged detail. It omits `profile`, `accessPrice`, and `capacity`, so those reach a progressive-mode agent only through the `attend_event` affordance, which requires already standing at the location. Own affinity and own repetition state are not disclosed. |
| AIT-1504 | In progress | Join charges access price and creates presence atomically or does neither; entry Energy, marginal presence Energy, partial attendance, and the no-refund early exit are implemented and tested. Price, capacity, and Energy blockers are now disclosed before entry by the one shared feasibility computation. The command is still named `attend_event` rather than `experience_join`, and the re-entry window is implemented but untested. |
| AIT-1505 | In progress | All seven factors resolve exactly once per attendance at departure or natural end, the breakdown sums to the raw delta, and variance is drawn once and is replay-stable. The resolution never reaches the owner feed, and no declared expectation is recorded to compare against. |
| AIT-1506 | In progress | Presence and interaction are separate factors with the approved importance, outcome, first-meeting novelty, and topic-fit terms, and their sign and relative weight are tested. Cross-occasion damping with the same counterpart remains. |
| AIT-1507 | In progress | Venue and dominant-dimension repetition over the 7-day window is implemented and tested. The novelty reward and a finer similarity function remain. |
| AIT-1509 | In progress | Passive decay with its floor and the per-job Happiness cost are implemented and tested. The `livedHappiness` Score component does not exist, so the cost of neglect is not yet realized. |
| AIT-1510 | In progress | The experiences catalog is already world-wide rather than location-gated, and is ordered and paged. Filtering is limited to location and time: no tag, profile, affinity, or price filter exists, no affinity is disclosed per item, and no filter reports what it removed. |

The local experiment infrastructure now also includes an Azure Foundry Chat Completions adapter, strict model-action validation, seven isolated HTTP/SSE workers, inference concurrency and temporal call caps, stale-projection recovery, rejection memory, a persistent seven-character fast-cycle configuration with twenty jobs, and a versioned pilot report. Vera and Rook deliberately add deceptive and hostile motivations while remaining subject to server authority.

## Reaching the Happiness engine: done on 2026-08-19

The engine had been implemented, tested, and unreachable. The world-configuration schema accepted only `id`, `title`, `locationId`, `startsInGameMinutes`, `durationGameMinutes`, and `creatorId` for an event, so every shipped world created experiences with `profile: null` and resolution short-circuited immediately. Character `preferences` were absent too, so all seven pilot residents took the even 50-across-ten default and shared an identical affinity for everything. Eight substantially implemented stories were unreachable from any runnable pilot, and the last seven-agent run recorded 1,384 events, two experiences, five attendances, and no Happiness event of any kind.

Three changes closed it:

1. **The configuration carries the world's content.** The schema accepts and forwards `profile`, `accessPrice`, `capacity`, and `description` on an experience, and `preferences` on a character. Both vectors are validated at the configuration layer rather than only by the domain, because a profile rejected half-way through activation would leave a partly-seeded world and break the invariant that an invalid configuration mutates nothing.
2. **Discovery.** The experiences catalog was already city-wide but disclosed neither what an evening delivers nor what it costs. Items now carry `profile`, derived `tags`, the character's own `affinity`, `accessPrice`, `capacity`, present `attendeeCount`, both Energy costs, and the character's own repetition outlook. Filters accept `tag`, `minimumAffinity`, and `maximumPrice` over the controlled ten dimensions, an unknown dimension is rejected rather than matching nothing, and `filteredOmitted` reports what any criteria filter removed. Ordering stays neutral: ranking would be the server choosing for the brain. Contract version 2.
3. **Measurement.** The run report gained an `experiences` section: attendances, re-entries, resolutions, positive and negative resolution rates, mean realized delta, **mean contribution per factor**, repeated-venue resolutions, distinct venues per attending resident, paid attendances, Credits spent on access, decay and work-cost counts, and both Happiness quantities per resident. `HAPPINESS_CHANGED`, `HAPPINESS_DECAYED`, `EXPERIENCE_HAPPINESS_RESOLVED`, and `EXPERIENCE_ACCESS_PAID` reach the owner feed with their factor breakdowns, and a resolved evening ranks with a completed job in summary priority.

The pilot world now seeds six profiled experiences across four locations, three of them priced and two capacity-limited, and seven distinct preference vectors drawn from the personalities already written. Affinity spread per resident runs from 7 to 95 where every cell would previously have been near 50, which is the only reason affinity discriminates at all.

The per-factor mean is the measurement that matters for what is still open: it is what distinguishes a factor doing real work from dead weight in the formula, and AIT-1506 and AIT-1507 both need it. The deterministic twenty-agent harness already reports `livedHappiness: -1.5` for every reference agent, since each completes one job and none goes anywhere — the work-only strategy made visible as data rather than asserted.

### Measured: the first two runs against the reachable engine

A twelve-minute verification run produced **7 attendances against the previous run's 5** in less than half the world time, and **no resolutions**. The missing resolutions were a setup error, not a defect: the run covered 83 world minutes and the earliest experience ends at world minute 90, so nothing had ended and nobody left early. A run has to outlast at least one experience before the engine can be measured at all.

The full thirty-minute run then produced the first end-to-end evidence: **8 attendances, 8 resolutions, 75% positive, 25% negative, mean realized delta +3.97.**

The engine does the thing it was designed for. At the same gathering, at the same time:

| Resident | Experience | Raw delta | Affinity factor |
| --- | --- | ---: | ---: |
| Elias, `socializing` 100 | welcome gathering | **+9.67** | +6.86 |
| Rook, `socializing` 10 | welcome gathering | **−1.73** | −2.57 |

Two residents in one room came away with opposite evenings, entirely from their own preferences. The work-versus-life split is visible in the same run: the two residents who only worked ended at `livedHappiness` −1.53 and −1.73, against +9.67 and +8.02 for the two who also lived.

#### What the factor means say

Mean contribution per resolution, over the seven factors that sum to the delta:

| Factor | Mean | Reading |
| --- | ---: | --- |
| `affinity` | **+2.84** | the workhorse, spread −2.57 to +6.86 |
| `crowd` | **+1.00** | a coarse ±2 step, and it outweighs interaction more than twofold |
| `interaction` | +0.42 | weak; four of eight resolutions had exactly 0, from residents who attended and never spoke |
| `variance` | +0.39 | as designed, small |
| `presenceValue` | **0.00** | zero in every single resolution |
| `repetition` | −0.19 | fired once in the whole run |
| `participation` | −0.50 | biting hard, with −4 and −2 values from late arrivals and early exits |

Four findings follow, and none of them could have been reached by argument:

1. **`presenceValue` is dead weight.** It is exactly 0.00 in all eight resolutions. Its divisor of 200 means a full ±2 needs the character's outgoing affinity minus tension to total ±400 across everyone present, which new relationships never approach. The factor whose purpose was "being in a room with people you like is worth something" currently never fires.
2. **`crowd` outweighs `interaction` by more than two to one.** This is the same class of defect as the original co-presence-beats-interaction problem, reappearing between a different pair: a resident currently gains more from the room being full than from talking to anyone in it.
3. **Novelty and repetition still cannot be calibrated.** `distinctVenuesPerAttendingCharacter` is **1**: every resident attended exactly one venue, one resident attended twice, and the repetition penalty fired once. There is almost no exploration to measure, which confirms with numbers what the twelve-minute run suggested.
4. **Passive decay never fires in a pilot.** Its window is one world day, 1,440 world minutes, and a full run is 180. The mandatory neglect pressure is therefore unobservable at pilot timescale, so nothing in a run can validate it.

#### Measured: the city runs, and stalls one step short

Three thirty-minute seven-agent runs against the same world, changing only the agent prompt and the job durations.

| | Run 1 original prompt | Run 2 purpose, in prose | Run 3 purpose, as a spec |
| --- | ---: | ---: | ---: |
| Conversation share of actions | 83% | 62% | 56% |
| Attendances | 3 | 10 | **18** |
| Resolutions | 0 | 7 | **18** |
| Paid attendances | 0 | 1 | **11** |
| Credits spent on admission | 0 | 20 | **520** |
| Buildings built | 0 | 0 | **1** |
| Catalog requests | 0 | 0 | **0** |

**The first agent-authored building exists.** Nia — the resident whose preferences are `competition 100, creativity 100` — bought plot 05-05 for 150 Credits and built *The Crucible*, "a compact workshop and competition venue with modular shelving, a central ring, and tool stations that double as spectator seating", on a profile of `competition 60, creativity 80` for 788 Credits.

Three things in that sentence are the design working rather than a feature being exercised. She chose **two** dimensions out of ten when she could have afforded a broader profile, which is the convex cost teaching the lesson without a rule forbidding anything. The server holds two numbers and five capabilities and knows nothing of rings or spectator seating. And the resident who built a competition venue is the one who cares about competition — preferences drove authorship.

**The loop then stalls before hosting.** `host_experience` was offered to Nia eight times after activation and she attended other people's evenings instead. Three candidate causes, none yet distinguished: hosting is a heavy action (title, description, profile within the ceiling, schedule, price, capacity) against one field for attending; no upkeep charge ever fired, so an idle building has not yet become the liability that would force the issue; and the prompt names the sequence without ever saying that an unhosted building is money standing still.

**No agent has ever requested a catalog, in any run.** Nia bought a far corner of the grid without looking at the map. The progressive-context protocol is in the prompt and in the manifest and has never once been used, so agents act only on what an observation already contains — which is also why `plots` and `buildings` being catalogs rather than affordance fields may be the wrong shape.

Factor means moved with the behaviour: `repetition` went from −0.19 to **−1.25**, because residents now attend enough to repeat themselves, and `distinctVenuesPerAttendingCharacter` is still **1**. `interaction` fell to 0.10 — they attend and barely speak — and `presenceValue` remains **0.00** across all three runs. Every resident finished with a positive lived total, from 4.8 to 18.1, against two negatives in run 1.

#### The exploration gap

Every attendance in both runs was at an experience where the resident already stood, or one they were already travelling to. Nobody travelled to the archive, and only one paid admission at all — 20 Credits, once.

The reference runtime's prompt has detailed guidance for conversations, appraisals, goals, invitations, and team jobs, and nothing that connects finding a congenial gathering to travelling to it. The `attend_event` affordance appears only when already co-located, so attending anything elsewhere requires a multi-step plan no instruction suggests. This has the same shape as the goal problem already recorded in the planner's own comment: the first pilot adopted zero goals in 165 actions because nothing asked it to want anything.

This is a candidate intervention, deliberately not applied before these baselines existed, so that a later change in exploration can be attributed to the change rather than to run length.

## Known defects

| Defect | Where | Effect |
| --- | --- | --- |
| `livedHappiness` is not initialized on character creation | `src/domain/world-reducer.js:19-26` | Correct only because two downstream readers default it to zero. |
| Feasibility gates entry Energy on the full cost even for a re-entry that is charged nothing | `eventAttendanceFeasibility` against the re-entry discount in `joinExperience` | A resident re-entering inside the window with less than 3 Energy is refused an entry that would have cost nothing. The approved policy states a separate "minimum Energy to enter" of 3, which the current behaviour satisfies, so this is left alone until that row is confirmed as a floor rather than a duplicate of the cost. |

### Fixed on 2026-08-19: the attendance disclosure divergences

Four defects in the same family, all of them one surface disagreeing with another about whether an evening was possible.

| Defect | Fix |
| --- | --- |
| Feasibility omitted the price and capacity blockers that the join enforced inline, so the affordance advertised an experience the resident could not afford or that was full, and `feasibleOnly` misclassified it | `eventAttendanceFeasibility` now decides every condition, appended after the existing codes so the error a multiply-blocked resident receives is unchanged. `joinExperience` throws from that one result instead of re-checking. |
| The observation's `upcomingEvents` projection dropped `accessPrice`, `capacity`, and `profile`, so the `attend_event` affordance advertised **every** experience as free, uncapped, and profile-less, despite a comment claiming it disclosed all three | The projection carries the three fields. This was the larger defect and it was found only because the feasibility test exercised the affordance rather than the catalog. |
| Two config keys held the same entry cost: `energy.eventAttendanceCost` gated feasibility while `experience.entryEnergyCost` was charged | `energy.eventAttendanceCost` is removed. Every site reads `experience.entryEnergyCost`, which the approved experience Energy policy owns. The disclosed field names are unchanged, since they are a published contract. |
| The catalog reported `gathering.attendees.size`, which is cumulative because attendance end never removes anyone, so a long-empty room read as full | The catalog uses `currentAttendeeCount`, the same count capacity is gated on. The cumulative set is left alone for the observer view that wants it. |

Covered by four tests in `test/experience-happiness.test.js`, including a table-driven one that checks the affordance, the catalog, and the command against each other for every way an entry can be refused. The suite is now 130 tests.

An affordance may legitimately be **absent** where a catalog entry is **blocked**: affordances state what can be attempted now, so a resident who is resting is offered nothing, while the catalog still lists the experience with its `ACTIVITY_CONFLICT`. The test asserts the weaker, correct invariant — an affordance must never offer what the command refuses.

## Newly specified and not yet implemented

The emergent-city review introduced 29 stories. Eight of them turned out to be substantially implemented once the code was mapped and are now `In progress` above; the delivery state of the existing Release 0 code is unchanged either way. Together they cover:

- decision-scoped rule and opportunity context instead of repeatedly sending complete catalogs;
- private brain-authored assessments of claims, suspected lies, and perceived promises;
- evidence-safe version-2 deception and formal-promise consequences without rewriting Release 0 history;
- a versioned 20 × 20 city grid, plots, agent-authored buildings with a chosen footprint and a convexly priced profile, upkeep, failure, and repurposing;
- city-wide discovery of what the city is offering, filtered by the same ten dimensions that carry preferences;
- partial experience attendance and participation-plus-duration Energy;
- brain-owned expectation against server-owned Realized Happiness, with presence and interaction separated, novelty, repetition, and neglect pressure;
- generic resident-created experiences, roles, access, services, donations, settlement, and Domain Reputation;
- verifiable building-quality investment with a bounded operational or experiential effect;
- dense run-level observability for plots, buildings, experiences, Happiness, economics, reputation, interactions, and stories.

The remaining cross-story contracts and numerical mechanics stay blocked from Ready status until their draft policies receive approved schemas or values in their first applicable version and gain acceptance tests.

Approved on 2026-08-19: the [progressive decision-context contract](rules/progressive-context-contract.md) at version 1 and then version 2, the [subjective claims and promises policy](rules/subjective-memory-policy.md) at version 1, the [grammar policy](rules/building-grammar-policy.md) at version 2, the [Experience and Happiness policy](rules/experience-happiness-policy.md) at version 2, and the [experience Energy](rules/experience-energy-policy.md) and [experience commerce](rules/experience-commerce-policy.md) policies at version 1. AIT-207, AIT-909, AIT-705, and AIT-706 are Ready and were raised to P0; AIT-1401 through AIT-1404, AIT-1501 through AIT-1505, and AIT-1510 are now Ready on the grammar, Happiness, Energy, commerce, and context versions they depend on.

Four E15 stories remain blocked on named remaining decisions rather than whole policies: AIT-1506 on cross-occasion interaction damping, AIT-1507 on the novelty reward, AIT-1508 on contributor value, and AIT-1509 on the `livedHappiness` Score weight.

## Measured baseline before the context work

The seven-agent Azure Foundry pilot recorded a median of **31 KB** of decision context per model call, with a p90 of 40 KB, in a world of seven characters. The cost of a decision therefore grows with the size of the world, which Increment D is designed to expand. Approved baseline budget is 8 KB soft and 16 KB hard.

## Remaining implementation priorities

1. Settle the open calibration in AIT-1506 and AIT-1507 against the per-factor means a seven-agent run produces, not against argument.
2. Record a declared `expectedHappiness` on join (AIT-1503), which is the last piece of the Happiness slice with no implementation at all.
4. Finish AIT-207 and AIT-909: the pinned-selection lifecycle and its invalidation codes.
5. Implement the approved subjective claims and promises policy in AIT-705 and AIT-706, so a character retains what it heard, from whom, and what it believed was promised.
6. Remove the remaining scaling limits: event-log snapshots instead of complete replay at boot. The projection-version and causal-lookup indexes are in place, and `World` is decomposed into the support, reducer, owner-projection, and context modules.
7. Replace JSONL with a transactional event/outbox store and command locks before a multi-node shared environment.
8. Finish operation-specific abuse/suspension telemetry and production delivery alerting in AIT-1003/AIT-1005.
9. Finish commitment cancellation/renegotiation, lateness and public reputation consequences in AIT-1302–AIT-1304.
10. Approve the remaining Increment D policy versions: courses and skills, Score component normalization and the `livedHappiness` weight, building economy and lifecycle, commerce beyond paid access, Experience Energy beyond attendance, evidence-safe relationships, Domain Reputation, and emergent-city metrics.
11. Implement the rest of the Increment D vertical slice: plot acquisition on the grid, agent-authored building with footprint and profile, upkeep, generic experience and contributor job, settlement, and failure or recovery.

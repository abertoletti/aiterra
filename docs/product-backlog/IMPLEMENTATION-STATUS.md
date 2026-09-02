# Release 0 implementation status

Last reviewed against the repository: **2026-08-26**.

This is the delivery inventory for the checked-in implementation. `Done` means the acceptance criteria and applicable [Definition of Done](DEFINITION-OF-DONE.md) checks are covered; specification-review markers remain independent from delivery state.

## Delivery snapshot

| Scope | Done | In progress | To do | Total |
| --- | ---: | ---: | ---: | ---: |
| Release 0 | 26 | 0 | 0 | 26 |
| Full product backlog | 48 | 35 | 17 | 100 |

Release 0 implementation coverage is **26 Covered**, **0 Test gap**, **0 Partial**, and **0 Missing**. The automated suite contains 245 passing tests, including validated external world configuration, file-backed restart recovery, an external-runtime integration gate, temporal per-agent inference limits, informative infeasible-action coverage, eight-turn conversation/fatigue coverage, versioned agent rules, location/event invitations, team jobs, pilot observability/reset coverage, a twenty-agent public-protocol gate, the resident-built city loop, paid courses, role applications, Domain Reputation, Expected-versus-Realized Happiness, building lifecycle/recovery and legacy land compatibility, and explicit wallet/escrow conservation.

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
| E09 — Minimal economy and opportunities | 7 | 1 | 2 | In progress |
| E10 — Operations, security, and metrics | 2 | 5 | 0 | In progress |
| E11 — Energy and recovery | 3 | 2 | 0 | In progress |
| E12 — Skills, popularity, Domain Reputation, and score | 3 | 0 | 3 | In progress |
| E13 — Invitations and social commitments | 1 | 3 | 0 | In progress |
| E14 — Emergent city and agent-authored buildings | 3 | 3 | 1 | In progress |
| E15 — Experience and Happiness Engine | 1 | 8 | 1 | In progress |
| E16 — Building operations and contributor economy | 1 | 7 | 1 | In progress |
| **Total** | **48** | **35** | **17** | **In progress** |

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
| AIT-1201 | Done | The configurable five-skill set now changes only from completed authoritative work or courses. Work discloses diminishing requirement-derived gains; catalog courses disclose exact positive or tradeoff effects; all effects are bounded, applied once, replayed, and consumed by later eligibility and hiring. |

## In-progress experiment extensions

| Story | Delivery | Current evidence and remaining gap |
| --- | --- | --- |
| AIT-207 | Done | Context contract v4 adds event-sourced, character-private `selectedContexts`, explicit select/release controls, a three-slot cap, six-world-hour expiry, full/progressive parity, correlated stale cycles, and idempotent stale rejection. The manifest is `agent-rules-v12`; deterministic replay and protocol coverage pass. A paired external-model pilot remains a measurement follow-up, not a correctness dependency. |
| AIT-909 | Done | `inspect_opportunities` returns every known opportunity with requirements, schedule, pay, energy, and all blockers, sharing one feasibility computation with the `accept_job` affordance. Retained opportunity context survives dependent actions, transitions atomically on engagement/terminal change, exposes a sanitized stale snapshot once, and is replay-safe. |
| AIT-1006 | In progress | Configuration owns the grid, profile taxonomy, tag derivation, capabilities, footprint/cost bounds, and active mechanic versions; construction stamps the grid and taxonomy versions, while the observer exposes the entire parameter set. Districts, capability compatibility, and activation validation of the complete cross-policy grammar remain. |
| AIT-1007 | In progress | The observer and run report expose city, building, experience, wallet, escrow, Happiness, Energy, skill, reputation and parameter state. Metric definition v3 retains Expected-versus-Realized error and adds scheduled upkeep coverage, recovery payments, warnings, transitions and interval-clipped lifecycle time. Multi-dimensional filters, the complete approved Increment-D metrics dictionary, and collusion indicators remain. |
| AIT-1102 | In progress | Movement, work, event, rest, and conversation costs are authoritative, disclosed, and applied once; training/study energy and interruption rules are not implemented yet. |
| AIT-1105 | In progress | Initial and marginal attendance Energy are disclosed, charged from authoritative presence exactly once, bounded, replay-safe, and exercised by partial attendance. The re-entry discount is implemented without a dedicated protocol test; contributor/performance and argument additions remain outside version 1. |
| AIT-1302 | In progress | Accept, decline, expiry, known-conflict validation, and shared commitment visibility exist; cancellation and renegotiation remain. |
| AIT-1303 | In progress | Travel-aware reminders are persisted and queued through the event channel; dedicated degraded-path coverage and richer incompatible-activity guidance remain. |
| AIT-1304 | In progress | Kept/missed outcomes apply directional promise rules; lateness, communicated cancellation, and public reputation effects remain. |
| AIT-1401 | Done | The full grid discloses occupancy, distance, travel time, availability and blockers. Grammar v3 stamps atomic construction/ground claims. Legacy purchases replay their recorded debit and ownership, allow only the buyer to build, and never charge land twice. |
| AIT-1402 | In progress | Free identity, rectangular footprint, controlled profile, derived tags, generic capabilities, and server-owned cost/capacity/upkeep are implemented and validated. Proposal and confirmation are still one command rather than a persisted quoted proposal. |
| AIT-1403 | In progress | Construction is paid, timed, atomic, idempotent, replay-safe, and activates one reachable location carrying its full mechanical identity. The exact pre-confirmation quote and complete cross-policy activation contract remain. |
| AIT-1404 | In progress | Every public building is discoverable city-wide with profile, tags, own affinity, state, footprint, distance, and capabilities; financial flow stays proprietor/operator-only. Pinned context and dedicated view/affordance metrics remain. |
| AIT-1405 | Done | Economy/lifecycle v1 defines wallet charges, rounded interval amounts, exact due instants, frozen building terms, and no hidden debt. Due/paid/failed events are correlated and replay-safe; chronological timers prevent future wages covering earlier bills. Coverage and recovery-payment metrics are distinct. |
| AIT-1406 | Done | Consecutive failures produce `DELINQUENT`, `INACTIVE`, and `CLOSED`, followed by timed `ABANDONED`. Warnings and idempotent `reactivate_building` recovery are exposed; historical failures remain. New sales and hiring stop, while accepted work/escrow, paid courses, existing attendance and commitments settle normally. Identity, footprint, ledger and lifecycle durations survive replay. |
| AIT-1501 | In progress | Ten-dimension preference vectors with the 500 budget, bounded saturating `happiness`, and unbounded `livedHappiness` are exposed only to their owning brain and are measured in the run report. Happiness events reach owner projections. `livedHappiness` still relies on reader defaults instead of explicit initialization in `CHARACTER_CREATED`, and recent causes are not yet a first-class character observation. |
| AIT-1502 | In progress | The ordered, paged experience view now includes profile, derived tags, own affinity, price, capacity, current attendance, Energy, feasibility, blockers, and own repetition outlook without a server prediction. Announced contributor detail, consent-aware attendee identity, selected-context retention, and dedicated detail metrics remain. |
| AIT-1503 | Done | Every knowable mechanical input is disclosed without a server prediction. `attend_event` accepts an optional bounded integer `expectedHappiness`, validates before side effects, persists one immutable attendance-correlated declaration, records realized-minus-expected at resolution, and reports declaration rate plus signed and absolute error under metric definition version 2. Omission, idempotent retry, and replay are covered. |
| AIT-1504 | In progress | Join charges access price and creates presence atomically or does neither; entry Energy, marginal presence Energy, partial attendance, and the no-refund early exit are implemented and tested. Price, capacity, and Energy blockers are now disclosed before entry by the one shared feasibility computation. The command is still named `attend_event` rather than `experience_join`, and the re-entry window is implemented but untested. |
| AIT-1505 | In progress | All seven factors resolve exactly once per attendance at departure or natural end, the breakdown sums to the raw delta, variance is replay-stable, declared expectation comparison is correlated, and resolutions reach owner projections and run metrics. Verified contributor and venue-quality inputs remain. |
| AIT-1506 | In progress | Presence and interaction are separate factors with the approved importance, outcome, first-meeting novelty, and topic-fit terms, and their sign and relative weight are tested. Cross-occasion damping with the same counterpart remains. |
| AIT-1507 | In progress | Venue and dominant-dimension repetition over the 7-day window is implemented and tested. The novelty reward and a finer similarity function remain. |
| AIT-1509 | In progress | Passive decay with its floor and the per-job Happiness cost are implemented and tested. The `livedHappiness` Score component does not exist, so the cost of neglect is not yet realized. |
| AIT-1510 | In progress | The experience catalog and compact `cityTonight` view are city-wide, deterministic, neutral, paged, read-only, and disclose profile, tags, own affinity, price, capacity, attendance, Energy, feasibility, and blockers. Tag, minimum-affinity, maximum-price, location, and time filters are validated and report omissions. Selection-to-inspection/attendance attribution and catalog-specific product metrics remain. |
| AIT-1601 | In progress | Proprietors can host idempotent, discoverable, free or paid experiences within an active building's profile/capacity/capability bounds; hosting has disclosed profile-scaled Energy and booking conflicts. Contributor needs, operating-cost reservation, quality, and terminal cancellation remain. |
| AIT-1602 | In progress | An active building publishes a generic labelled role on a public board with skill and Domain Reputation requirements, schedule, Energy, wage, and full escrow from the proprietor's wallet. Correlation to contributor needs declared by a hosted experience remains. |
| AIT-1604 | In progress | Selected residents independently travel, start, complete, abandon, cancel, or no-show through the authoritative work lifecycle; completion settles wage, skills, and reputation once. Experience-specific contributor presence, quality, Happiness value, and dedicated contribution events remain. |
| AIT-1605 | In progress | Paid access is atomic with entry and resident-provided courses implement one verified `sell_service` path, both credited to the proprietor and building ledger. General services, donations, fulfillment, and the complete refund/fee contract remain. |
| AIT-1606 | In progress | Resident-created experiences open their venue, are found city-wide, admit independent residents, support compatible interaction and partial departure, and settle Energy and Happiness. Required contributor coverage, proprietor cancellation, staffing/empty outcomes, and interruption handling remain. |
| AIT-1607 | In progress | Admission and tuition revenue, upkeep, wages, escrow, and the proprietor wallet reconcile with replay-safe per-building flow tags and observer totals. Lifecycle v1 preserves existing obligations during failure. Operating costs, donation/service refunds and complete operation-level settlement remain. |
| AIT-1608 | In progress | Work-skill Domain Reputation and organizer general reputation are verified, attributed, bounded, anti-farmed, replayed, public, and consumed by hiring. Experience-profile domains, contributor quality, separate organizer/contributor domain attribution, and expectation use remain. |

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

**The first agent-authored building exists.** Under the then-current separate-purchase implementation, Nia — the resident whose preferences are `competition 100, creativity 100` — bought plot 05-05 for 150 Credits and built *The Crucible*, "a compact workshop and competition venue with modular shelving, a central ring, and tool stations that double as spectator seating", on a profile of `competition 60, creativity 80` for 788 Credits. The checked-in successor behavior now claims ground atomically with construction, as recorded in AIT-1401.

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

Covered by the focused tests in `test/experience-happiness.test.js`, including Expected Happiness validation, immutable correlation, omission, idempotent retry, replay, metrics, and a table-driven check that the affordance, catalog, and command agree on every refusal. The complete suite now contains 245 passing tests.

An affordance may legitimately be **absent** where a catalog entry is **blocked**: affordances state what can be attempted now, so a resident who is resting is offered nothing, while the catalog still lists the experience with its `ACTIVITY_CONFLICT`. The test asserts the weaker, correct invariant — an affordance must never offer what the command refuses.

## Increment D delivery reconciliation

The 2026-08-25 review mapped the current code and 226-test suite back to every Increment D acceptance contract. E14 and E16 are no longer represented as untouched: construction, city-wide discovery, upkeep, hosting, admissions, courses, role publication/application, hiring, wages, skills, and Domain Reputation all have meaningful implementation and are now `In progress` or `Done` above. AIT-1503 is now complete end to end. The delivery state of Release 0 remains unchanged. The remaining Increment D scope covers:

- decision-scoped rule and opportunity context instead of repeatedly sending complete catalogs;
- private brain-authored assessments of claims, suspected lies, and perceived promises;
- evidence-safe version-2 deception and formal-promise consequences without rewriting Release 0 history;
- a persisted construction proposal/quote workflow, complete cross-policy activation, and later building transfer/repurposing;
- city-wide discovery of what the city is offering, filtered by the same ten dimensions that carry preferences;
- partial experience attendance and participation-plus-duration Energy;
- brain-owned expectation against server-owned Realized Happiness, with presence and interaction separated, novelty, repetition, and neglect pressure;
- completion of generic resident-created experiences, contributor correlation, services, donations, operation settlement, and experience-domain reputation;
- verifiable building-quality investment with a bounded operational or experiential effect;
- dense run-level observability for plots, buildings, experiences, Happiness, economics, reputation, interactions, and stories.

The remaining cross-story contracts and numerical mechanics stay blocked from Ready status until their draft policies receive approved schemas or values in their first applicable version and gain acceptance tests.

Approved on 2026-08-19: the [progressive decision-context contract](rules/progressive-context-contract.md) at version 1 and then version 2, the [subjective claims and promises policy](rules/subjective-memory-policy.md) at version 1, the [grammar policy](rules/building-grammar-policy.md) at version 2, the [Experience and Happiness policy](rules/experience-happiness-policy.md) at version 2, and the [experience Energy](rules/experience-energy-policy.md) and [experience commerce](rules/experience-commerce-policy.md) policies at version 1. The [course and skill progression](rules/course-skill-progression-policy.md) and [Domain Reputation](rules/domain-reputation-policy.md) policies reached version 1 on 2026-08-20. AIT-207, AIT-909, AIT-705, and AIT-706 are Ready and were raised to P0; the implemented subsets and remaining blockers of E14–E16 are recorded per story above.

Four E15 stories remain blocked on named remaining decisions rather than whole policies: AIT-1506 on cross-occasion interaction damping, AIT-1507 on the novelty reward, AIT-1508 on contributor value, and AIT-1509 on the `livedHappiness` Score weight.

On 2026-08-26, grammar version 3 and economy/lifecycle version 1 completed AIT-1401, AIT-1405 and AIT-1406. The historical grammar-v2 document is preserved separately. Seven focused lifecycle tests cover every state, warnings, authorization, explicit and automatic recovery, idempotency, chronological restart, frozen terms, legacy purchases/failures, metrics windows, and continued settlement of work, tuition, attendance and commitments. No external-model pilot was needed for these deterministic contracts.

## Measured baseline before the context work

The seven-agent Azure Foundry pilot recorded a median of **31 KB** of decision context per model call, with a p90 of 40 KB, in a world of seven characters. The cost of a decision therefore grows with the size of the world, which Increment D is designed to expand. Approved baseline budget is 8 KB soft and 16 KB hard.

## Remaining implementation priorities

### Pilot-v9 corrective gate completed (2026-08-26)

The 30-minute v9 pilot recorded 10 immutable Expected/Realized pairs (mean 10.80 versus 4.12, MAE 6.68), but included free seeded experiences and no in-experience decision checkpoints. It is evidence for the recording pipeline, not economic validation or weight calibration.

Implemented under `agent-rules-v10`: system-funded unfilled-slot expiry/refund/renewal (resident roles unchanged); shared work-start and conversation-turn feasibility; topic enums and bounded validation-error feedback/repair; entry and periodic attendance decisions with explicit `stay_experience`; known targets, durable permitted goal sources, optional planning and correct `guidance` naming; persistent private last-five prediction/outcome feedback. Reward weights are unchanged. `test/pilot-v10-regressions.test.js` covers ten regressions. Two managed-launcher tests cover scope guards and failure cleanup without model calls. The managed launcher snapshots a fresh seedless world and stops its own server when the runner ends or fails.

These are corrections to implemented subsets, not completion of the remaining E15/E16 acceptance criteria. Backlog totals remain unchanged. Next evidence: a fresh 10-agent, 30-minute seedless pilot. If no agent creates a venue or experience, report the missing economic activity rather than infer Happiness calibration.

### Product priorities

1. Settle the open calibration in AIT-1506 and AIT-1507 against a pilot with enough resolved, interactive, and repeated experiences. The existing ten-agent, 120-minute baseline produced only four resolutions: mean affinity `+4.99`, presence `+0.03`, interaction `0`, participation `+0.50`, crowd `-1.00`, repetition `0`, variance `-0.71`, and raw delta `+3.80`. A fresh ten-agent Expected-Happiness smoke run produced nine attendances, eight declarations, four first-event resolutions, and three resolved comparisons: mean prediction `+10.67`, mean realized `+4.97`, signed error `-5.70`, and absolute error `5.70`. Both samples prove the pipeline but are too small and contain no repetition, so they do not justify changing weights.
2. Close the E16 operation chain: correlate hosted contributor needs to roles, verify performance, add contributor Happiness value, and settle operating costs, services, donations, and refunds.
3. Finish AIT-1402/AIT-1403's persisted proposal and exact pre-confirmation quote, including complete cross-policy activation validation.
4. Finish the remaining E14 discovery metrics together with the context work below.
5. Finish AIT-207 and AIT-909: the pinned-selection lifecycle and its invalidation codes.
6. Implement the approved subjective claims and promises policy in AIT-705 and AIT-706, so a character retains what it heard, from whom, and what it believed was promised.
7. Remove the remaining scaling limits: event-log snapshots instead of complete replay at boot, then a transactional event/outbox store and command locks before a multi-node shared environment.
8. Finish operation-specific abuse/suspension telemetry and production delivery alerting in AIT-1003/AIT-1005.
9. Finish commitment cancellation/renegotiation, lateness and public reputation consequences in AIT-1302–AIT-1304.
10. Approve the remaining Increment D policy versions: Score normalization and the `livedHappiness` weight, building transfer/repurposing/quality, commerce beyond paid access, Experience Energy beyond attendance, evidence-safe relationships, experience-domain reputation, and the rest of emergent-city metrics.

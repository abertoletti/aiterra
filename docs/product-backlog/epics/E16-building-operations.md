# E16 — Building operations and contributor economy

**Status:** In progress

## Objective

Turn resident-authored buildings into generic generators of experiences, jobs, movement, encounters, and economic consequences.

## Expected outcome

A proprietor creates an experience, recruits an independently controlled contributor, attracts independently deciding attendees, and receives actual profit or loss while contributors build contextual reputation.

The initial vertical slice may be narrated by agents as a club and DJ, a church and speaker, a restaurant and chef, or something entirely new. The server uses the same capabilities, transactions, contributor, attendance, and experience rules in every case. A place may rationally lose Credits while creating Happiness, relationships, popularity, Domain Reputation, donations, or goal-relevant opportunities; profit is important but is not the only source of value.

## Stories

### AIT-1601 — Create an experience from a building capability

**Priority:** P1 · **Increment:** D · **Status:** In progress

**Specification:** Updated (2026-08-19)

As an external agent controlling a proprietor character, I want to create an experience at an eligible building so that my investment can attract residents and create stories.

**Acceptance criteria**

- Only an active building with `host_event` can create an experience.
- The proprietor supplies a bounded free name and description plus a controlled experience profile, schedule, access proposal, and contributor needs.
- **The experience profile cannot exceed the building's profile in any dimension.** This is what the proprietor's construction investment bought: a building with modest `music` can host a gathering with some music in it and can never host the city's great music night, and a proprietor who wants to host that has to have paid for the capability first.
- A building whose profile is empty in every dimension can host nothing, since an experience must deliver something.
- Capacity cannot exceed the building's current capacity, which the building's footprint derives, and a price requires a compatible commercial capability.
- The proposal discloses the applicable ceiling before submission, so an over-ambitious profile is visible as a bound rather than an opaque rejection.
- A free experience is valid. A paid experience publishes one access offer under the [experience commerce policy](../rules/experience-commerce-policy.md); the proprietor cannot attach a second admission transaction.
- Operating cost, Energy model, profile bounds, quality inputs, and possible mechanical effects are server-derived from approved policies.
- Funding, schedule conflicts, building state, capabilities, and proposal bounds are revalidated on submission.
- Successful creation publishes one persistent, discoverable experience and invitation target; retry cannot duplicate it or its reservation.
- Description and role labels may influence brain reasoning but cannot directly assign Happiness, attendance, quality, or revenue.

**Events and metrics:** `resident_experience_created`, `resident_experience_rejected`, experiences created per active building.

**Dependencies:** AIT-601, AIT-1403, AIT-1404, AIT-1502.

**Current delivery note:** An active proprietor-owned building with `host_event` can publish a persistent city-wide experience with bounded identity, schedule, capacity, optional admission, and a controlled profile that defaults to and cannot exceed the building profile. Hosting costs profile-scaled Energy, prevents overlapping bookings, is exposed through the public action protocol, and is idempotent. Contributor needs, operating-cost reservation, quality inputs, and terminal cancellation behavior remain.

### AIT-1602 — Publish a funded job or contributor role

**Priority:** P1 · **Increment:** D · **Status:** In progress

As an external agent controlling a proprietor character, I want to publish a funded role with structured requirements so that another resident can contribute to an activity in exchange for disclosed pay.

**Acceptance criteria**

- The `create_job` capability permits a free role label and duties together with structured required skills, reputation domain when relevant, experience relevance, schedule, duration, Energy cost, wage, and cancellation rules.
- There is no hardcoded `DJ` role, semantic occupation class, or fixed `creativity >= 70` rule.
- Requirements and duties must be compatible with the building, capability, and associated experience under the controlled grammar.
- The full promised wage is reserved before publication according to the [job escrow policy](../rules/job-escrow-policy.md).
- The proprietor cannot invent Domain Reputation, Happiness, performance quality, or an attendance benefit.
- Busy and ineligible residents can inspect the role and their known blockers on demand; application and start revalidate all requirements.
- Publication is atomic and idempotent.

**Events and metrics:** `building_role_published`, `building_role_rejected`, `building_wage_reserved`, qualified applicants per role.

**Dependencies:** AIT-909, AIT-905, AIT-1201, AIT-1403, AIT-1601.

**Current delivery note:** A proprietor can publish a free-labelled, structured role from an active `create_job` building, pin its notice to a public square, choose skill and Domain Reputation requirements, schedule, duration, Energy, and wage, and reserve the full wage from its own wallet through the existing escrow policy. Publication and retry are atomic, blocked candidates retain the full notice, and application/start revalidate eligibility. Explicit correlation to contributor needs declared by a hosted experience remains.

### AIT-1603 — Apply for and fill a resident-created role

**Priority:** P1 · **Increment:** D · **Status:** Done

As an external agent, I want my character to apply for and be selected for a resident-created role independently so that employment creates coordination without giving the proprietor control over another resident.

**Acceptance criteria**

- A candidate explicitly applies; the proprietor cannot enroll, move, schedule, or act for another character.
- The server validates qualifications, availability, conflicts, and eligibility while exposing only verified public or legitimately learned candidate information.
- The proprietor's brain may select among eligible applicants before the deadline using an authoritative intention.
- Selection creates one correlated commitment containing building, experience when applicable, schedule, role, wage, and cancellation consequences for both parties.
- Eligibility, presence, Energy, and temporal compatibility are revalidated at start; stale selection does not lose or duplicate escrow.
- Application, withdrawal, selection, rejection, cancellation, no-show, start, and completion remain reconstructable.

**Events and metrics:** `building_role_applied`, `building_role_application_withdrawn`, `building_role_filled`, `building_role_candidate_rejected`, fill rate and time to fill.

**Dependencies:** AIT-902, AIT-906, AIT-1201, AIT-1302, AIT-1602.

### AIT-1604 — Perform as a verified contributor

**Priority:** P1 · **Increment:** D · **Status:** In progress

As an external agent controlling a selected contributor, I want to start and complete the contribution as my own character so that skill and reputation value come from real participation.

**Acceptance criteria**

- Start requires the selected contributor to be present, eligible, available, and able to pay the disclosed additional Energy cost.
- Contribution is a server-authoritative activity whose compatibility with social interactions is explicit.
- Completion, abandonment, no-show, cancellation, and infrastructure interruption are distinct factual outcomes.
- Only a valid started performance can feed realized contributor value, wage settlement, and Domain Reputation.
- Performance quality derives from approved mechanical inputs and verified outcomes, never the contributor's or proprietor's free self-assessment.
- Completion and every resulting effect happen exactly once after retry or restart.

**Events and metrics:** `contribution_started`, `contribution_completed`, `contribution_abandoned`, `contributor_no_show`, completion by role profile.

**Dependencies:** AIT-903, AIT-1105, AIT-1508, AIT-1603.

**Current delivery note:** A selected resident independently travels to the building, starts the role as authoritative work, pays the disclosed work Energy, may converse when compatible, and completes, abandons, cancels, or no-shows through the tested job lifecycle. Completion pays escrow once and can change skills and Domain Reputation. Experience-specific contributor presence, performance quality, contributor Happiness value, and dedicated contribution events remain.

### AIT-1605 — Sell access or services and accept donations

**Priority:** P1 · **Increment:** D · **Status:** In progress

As an external agent controlling an eligible character, I want to offer or purchase a building transaction so that different places can sustain different economic and non-profit strategies.

**Acceptance criteria**

- Each transaction requires the corresponding active capability: `sell_access`, `sell_service`, or `accept_donation`.
- `sell_access` charges only a verified entrant; `sell_service` requires an explicit purchaser and a verifiable fulfillment state; `accept_donation` requires a voluntary payer action and grants no undisclosed benefit.
- For experience admission, `sell_access` authorizes and prices the offer, while `experience_join` is the only command that atomically charges it and creates entry; no separate access-sale command may charge the same attendance.
- The authorized proprietor may propose a price only within the applicable policy and capability bounds; the purchaser cannot alter the published price.
- Price, balance, eligibility, capacity, building state, and fulfillment requirements are revalidated.
- Payment and fulfillment transitions are atomic, idempotent, and reconstructable.
- Fake customers, duplicate entry, passive traffic, or invented service completion cannot mint Credits.
- Refund and cancellation behavior is disclosed before payment.
- Fees, operating reservations, settlement order, and refunds follow the [experience commerce policy](../rules/experience-commerce-policy.md).

**Events and metrics:** `building_access_sold`, `building_service_sold`, `building_donation_received`, `building_transaction_rejected`, revenue by capability.

**Dependencies:** AIT-402, AIT-904, AIT-1404.

**Current delivery note:** `sell_access` is enforced through the single atomic join transaction, including price bounds, capacity, balance, replay, and no-refund early exit. `sell_service` has one verified implementation through catalog-owned courses whose tuition is paid atomically to the proprietor and recorded against the building. General services, voluntary donations, service fulfillment, and the complete refund/fee policy remain unimplemented.

### AIT-1606 — Operate a resident-created experience

**Priority:** P1 · **Increment:** D · **Status:** In progress

As an external agent, I want each resident to decide independently whether to enter, remain, work, interact, or leave so that a hosted experience creates authentic co-presence rather than scripted attendance.

**Acceptance criteria**

- An experience may be free and may require no contributor role; non-profit operation does not depend on a commerce or staffing capability.
- Starting revalidates building state, schedule, any operating funds, and only the contributor coverage declared as required by that experience.
- Residents independently decide whether and when to enter, remain, interact, perform, and leave.
- Attendance derives only from authoritative presence; capacity, access, any applicable payment, and primary-activity compatibility are enforced.
- When an experience uses paid access or contributors, the independently implemented AIT-1604 and AIT-1605 outcomes are correlated with operation; their absence does not invent a requirement for an experience that declared neither.
- A paid join either records one correlated access payment and presence change or records neither; cancellation and early departure use the published refund contract.
- Workers and guests become co-present and can use existing encounter, conversation, invitation, relationship, knowledge, and commitment systems when compatible.
- Missing contributors, proprietor cancellation, zero attendance, overcrowding, and infrastructure interruption resolve through explicit factual outcomes.
- The proprietor cannot create attendees, satisfaction, relationships, Happiness, or revenue by declaration.

**Events and metrics:** `resident_experience_started`, `resident_experience_cancelled`, `resident_experience_completed`, attendance, encounters, staffing failures, early departures.

**Dependencies:** AIT-501, AIT-1301, AIT-1504, AIT-1505, AIT-1601.

**Current delivery note:** Resident-created experiences open the building for travel, are discoverable without invitation, accept independently chosen free or paid entry, enforce capacity and activity conflicts, permit conversation and early departure, charge actual-duration Energy, and resolve Realized Happiness exactly once. Required contributor coverage, proprietor cancellation, zero-attendance and staffing outcomes, infrastructure-interruption handling, and correlation to a dedicated contributor activity remain.

### AIT-1607 — Settle building revenue, wages, and operating costs

**Priority:** P1 · **Increment:** D · **Status:** In progress

**Specification:** Updated (2026-08-25)

As an external agent controlling a proprietor character, I want each operation settled from verified activity so that the building can make a profit or loss and unproductive ownership remains costly.

**Acceptance criteria**

- The proprietor wallet and building-attributed ledger separately record access and service revenue, donations, reserved wages, operating costs, refunds, and upkeep.
- Only verified transactions create revenue; attendance without a valid charge never implies payment.
- A contributor who completes valid work receives the reserved wage exactly once even when attendance or proprietor profit is poor.
- Completion atomically settles revenue, escrow, operating costs, and refunds under the approved policies.
- Settlement order, fees, operating reservations, refunds, and distribution eligibility follow the [experience commerce policy](../rules/experience-commerce-policy.md).
- Profit or loss reflects actual operation. Revenue is credited directly to the proprietor wallet and tagged to the building; there is no separate building purse or proprietor distribution.
- A financial loss does not erase verified social, Happiness, popularity, or reputation outcomes; those dimensions remain independently attributed.
- An unprofitable operation can reduce upkeep coverage and causally move the building toward its failure lifecycle.
- Historical settlement is immutable, idempotent, and correlated with every source transaction and activity.

**Events and metrics:** `building_operation_settled`, `building_revenue_recorded`, `building_cost_charged`, `building_wage_settled`, profit and loss distribution.

**Dependencies:** AIT-906, AIT-1405, AIT-1604, AIT-1605, AIT-1606.

**Current delivery note:** Verified admission and course revenue is credited directly to the proprietor's wallet and tagged into an immutable per-building revenue ledger; upkeep and reserved role wages debit the same wallet, escrow settles the worker exactly once, and the observer reports earned, upkeep, and net flows. Economy/lifecycle v1 preserves existing work, tuition, attendance and commitments during failure while blocking new operations. Operating costs, donations, general-service refunds and complete operation-level settlement remain open.

### AIT-1608 — Build Domain Reputation from verified outcomes

**Priority:** P1 · **Increment:** D · **Status:** In progress

As an owner, I want contributors and organizers to build contextual reputations through actual outcomes so that important people emerge from world history rather than developer assignment.

**Acceptance criteria**

- Reputation supports `general` plus controlled contextual domains under the [Domain Reputation policy](../rules/domain-reputation-policy.md).
- Verified performance, completion, no-show, repeat hiring, organizer outcomes, attendance, and realized experience outcomes are eligible inputs only when the policy defines their attribution.
- An LLM cannot directly assign reputation, choose a numeric delta, or invent an audience or performance.
- Organizer and contributor reputations are independently attributed, and repetition limits prevent cooperating agents from farming a domain.
- Known Domain Reputation contributes to Expected Happiness only when relevant to the experience profile.
- A character can be highly reputable in one domain and weak in another.
- Popularity, directional trust, general reputation, and Domain Reputation remain distinct values and causes.

**Events and metrics:** `domain_reputation_changed`, source and domain distribution, repeat hiring, contributor career progression.

**Dependencies:** AIT-1202, AIT-1505, AIT-1508, AIT-1604, AIT-1606.

**Current delivery note:** General plus controlled work-skill Domain Reputation is persisted, public, replay-safe, source-attributed, bounded, anti-farmed, and usable as a resident-created role requirement. Completed and failed work affect contributor domains, while a positively resolved hosted night affects its organizer's general reputation. Experience-profile domains, mechanically verified contributor quality, separate organizer/contributor domain attribution, and any use in a brain-owned expectation remain.

### AIT-1609 — Invest in building quality

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-19)

As an external agent controlling a proprietor character, I want to invest in verifiable building quality so that improving a place can increase experiential or operational value while creating additional cost and risk.

**Open question narrowed:** grammar version 2 gives the building profile a price and a mechanical use — it is the ceiling on what the building's experiences can deliver — which is most of what a separate quality value was for. The remaining decision is whether quality survives as its own dimension at all, or whether raising the profile of an existing building *is* the quality investment. This story stays blocked until that is answered, and answering it may replace it rather than unblock it.

**Acceptance criteria**

- The proprietor can inspect eligible quality investments with authoritative cost, duration, prerequisites, resulting quality change, upkeep impact, and the exact bounded mechanical factor they affect.
- The first approved policy gives quality at least one non-cosmetic use, including a bounded venue-quality contribution to Expected and Realized Happiness or a disclosed operational factor such as capacity or service reliability.
- A quality investment never grants direct attendance, guaranteed positive Happiness, invented customers, or an unbounded multiplier.
- Submission revalidates building ownership and state, funds, plot and capability constraints, schedule conflicts, and the active policy versions.
- Payment, timed upgrade state, completion, quality change, and upkeep change are atomic and idempotent across retry and restart.
- Narrative description, tags, and proprietor or contributor self-assessment cannot directly set quality.
- Quality history, investment, degradation when enabled, and every downstream factor retain source events and policy versions.

**Events and metrics:** `building_quality_upgrade_started`, `building_quality_changed`, `building_quality_upgrade_rejected`, quality investment, upkeep change, quality contribution to experience outcomes.

**Dependencies:** AIT-1403, AIT-1405, AIT-1503, AIT-1505, AIT-1601.

## Decisions required before stories become Ready

Paid access, courses, work-skill Domain Reputation, hiring, the proprietor-wallet flow, and building lifecycle v1 are implemented. The remaining blocked slices need approved versions for services and donations, operating costs and settlement order, contributor/performance Energy, contributor Happiness value, experience-domain reputation, and building quality. These decisions live in the [building economy and lifecycle](../rules/building-economy-lifecycle-policy.md), [experience commerce](../rules/experience-commerce-policy.md), [Experience Energy](../rules/experience-energy-policy.md), [Experience and Happiness](../rules/experience-happiness-policy.md), and [Domain Reputation](../rules/domain-reputation-policy.md) policies.

## Out of scope

- employer or proprietor control over another character's actions;
- semantic server code for particular contributor roles or business types;
- passive revenue without a verified payer or fulfilled activity;
- arbitrary client-authored mechanical rewards;
- multi-owner corporations, equity, franchising, loans, securities, and complex accounting.

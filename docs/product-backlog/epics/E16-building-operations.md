# E16 — Building operations and contributor economy

**Status:** To do

## Objective

Turn resident-authored buildings into generic generators of experiences, jobs, movement, encounters, and economic consequences.

## Expected outcome

A proprietor creates an experience, recruits an independently controlled contributor, attracts independently deciding attendees, and receives actual profit or loss while contributors build contextual reputation.

The initial vertical slice may be narrated by agents as a club and DJ, a church and speaker, a restaurant and chef, or something entirely new. The server uses the same capabilities, transactions, contributor, attendance, and experience rules in every case. A place may rationally lose Credits while creating Happiness, relationships, popularity, Domain Reputation, donations, or goal-relevant opportunities; profit is important but is not the only source of value.

## Stories

### AIT-1601 — Create an experience from a building capability

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent controlling a proprietor character, I want to create an experience at an eligible building so that my investment can attract residents and create stories.

**Acceptance criteria**

- Only an active building with `host_event` can create an experience.
- The proprietor supplies a bounded free name and description plus a controlled experience profile, schedule, access proposal, and contributor needs.
- Capacity cannot exceed the building's current capacity, and a price requires a compatible commercial capability.
- A free experience is valid. A paid experience publishes one access offer under the [experience commerce policy](../rules/experience-commerce-policy.md); the proprietor cannot attach a second admission transaction.
- Operating cost, Energy model, profile bounds, quality inputs, and possible mechanical effects are server-derived from approved policies.
- Funding, schedule conflicts, building state, capabilities, and proposal bounds are revalidated on submission.
- Successful creation publishes one persistent, discoverable experience and invitation target; retry cannot duplicate it or its reservation.
- Description and role labels may influence brain reasoning but cannot directly assign Happiness, attendance, quality, or revenue.

**Events and metrics:** `resident_experience_created`, `resident_experience_rejected`, experiences created per active building.

**Dependencies:** AIT-601, AIT-1403, AIT-1404, AIT-1502.

### AIT-1602 — Publish a funded job or contributor role

**Priority:** P1 · **Increment:** D · **Status:** To do

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

### AIT-1603 — Apply for and fill a resident-created role

**Priority:** P1 · **Increment:** D · **Status:** To do

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

**Priority:** P1 · **Increment:** D · **Status:** To do

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

### AIT-1605 — Sell access or services and accept donations

**Priority:** P1 · **Increment:** D · **Status:** To do

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

### AIT-1606 — Operate a resident-created experience

**Priority:** P1 · **Increment:** D · **Status:** To do

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

### AIT-1607 — Settle building revenue, wages, and operating costs

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent controlling a proprietor character, I want each operation settled from verified activity so that the building can make a profit or loss and unproductive ownership remains costly.

**Acceptance criteria**

- The ledger separately records proprietor funding, access and service revenue, donations, reserved wages, operating costs, refunds, upkeep, and proprietor distributions.
- Only verified transactions create revenue; attendance without a valid charge never implies payment.
- A contributor who completes valid work receives the reserved wage exactly once even when attendance or proprietor profit is poor.
- Completion atomically settles revenue, escrow, operating costs, and refunds under the approved policies.
- Settlement order, fees, operating reservations, refunds, and distribution eligibility follow the [experience commerce policy](../rules/experience-commerce-policy.md).
- Profit or loss reflects actual operation, and funds flow to the disclosed building balance before an optional proprietor distribution.
- A financial loss does not erase verified social, Happiness, popularity, or reputation outcomes; those dimensions remain independently attributed.
- An unprofitable operation can reduce upkeep coverage and causally move the building toward its failure lifecycle.
- Historical settlement is immutable, idempotent, and correlated with every source transaction and activity.

**Events and metrics:** `building_operation_settled`, `building_revenue_recorded`, `building_cost_charged`, `building_wage_settled`, `building_distribution_paid`, profit and loss distribution.

**Dependencies:** AIT-906, AIT-1405, AIT-1604, AIT-1605, AIT-1606.

### AIT-1608 — Build Domain Reputation from verified outcomes

**Priority:** P1 · **Increment:** D · **Status:** To do

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

### AIT-1609 — Invest in building quality

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent controlling a proprietor character, I want to invest in verifiable building quality so that improving a place can increase experiential or operational value while creating additional cost and risk.

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

The building grammar and Experience/Happiness authority boundaries are already fixed. Numeric pricing bounds, transaction fees, operating cost, refund rules, performance-quality inputs, Domain Reputation taxonomy and deltas, and anti-collusion windows still require approved versions of the [building economy and lifecycle](../rules/building-economy-lifecycle-policy.md), [experience commerce](../rules/experience-commerce-policy.md), [Experience and Happiness](../rules/experience-happiness-policy.md), and [Domain Reputation](../rules/domain-reputation-policy.md) draft policies.

## Out of scope

- employer or proprietor control over another character's actions;
- semantic server code for particular contributor roles or business types;
- passive revenue without a verified payer or fulfilled activity;
- arbitrary client-authored mechanical rewards;
- multi-owner corporations, equity, franchising, loans, securities, and complex accounting.

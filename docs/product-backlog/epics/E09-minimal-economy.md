# E09 — Minimal economy and opportunities

**Status:** In progress

## Objective

Create enough incentives and encounter contexts to generate social stories without turning the MVP into an economic simulator.

## Expected outcome

Characters can need credits, accept simple activities, and meet in shared locations; economic outcomes remain authoritative.

## Stories

### AIT-901 — Discover known opportunities

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to see accessible and known job or event opportunities so that I can choose activities that create goals and encounters.

**Acceptance criteria**

- Every opportunity shows location, schedule, duration, requirements, and possible compensation.
- Only public opportunities or opportunities learned by the character are exposed.
- A known public opportunity remains visible when the character is busy, elsewhere, already committed, or missing a requirement; its feasibility lists every known blocker.
- The server re-evaluates availability and requirements on acceptance.
- The agent cannot modify compensation or conditions.

**Events and metrics:** `opportunities_viewed`, considered and accepted opportunities.

**Dependencies:** AIT-202, AIT-301.

**Increment D extension:** AIT-909 changes when the detailed catalog is supplied, not which known opportunities it contains. The requested catalog must continue to satisfy every criterion above, including visibility of blocked opportunities.

### AIT-902 — Accept and complete paid work

**Priority:** P0 · **Increment:** B · **Status:** Done

As an external agent, I want to propose accepting paid work so that I can pursue economic goals while entering a social context.

**Acceptance criteria**

- The server verifies requirements, availability, location, and temporal compatibility.
- The activity starts and ends at times determined by the world.
- The server applies compensation only after valid completion.
- Retries, restarts, and duplicate notifications do not duplicate compensation.
- Required presence allows compatible social events during the activity.

**Events and metrics:** `job_accepted`, `job_completed`, `job_failed`, encounters during work.

**Dependencies:** AIT-901, AIT-303, AIT-403.

### AIT-903 — React socially during a compatible activity

**Priority:** P0 · **Increment:** B · **Status:** Done

As an external agent, I want to react to a relevant person without automatically abandoning work so that spontaneous stories can emerge in economic locations.

**Acceptance criteria**

- The activity declares which secondary social reactions are compatible.
- A reaction can have a server-determined cost or risk but does not automatically interrupt the activity.
- Incompatible reactions are rejected with possible alternatives.
- Social and economic outcomes remain distinct but correlatable events.

**Events and metrics:** social reactions during activities, activities interrupted by interaction.

**Dependencies:** AIT-303, AIT-603, AIT-502.

### AIT-904 — Spend credits on a simple need

**Priority:** P1 · **Increment:** B · **Status:** To do

**Specification:** Updated (2026-08-18)

As an external agent, I want to spend credits to satisfy a need or attend an event so that I can create understandable economic choices and consequences.

Paid experience entry and resident-provider transactions follow the [experience commerce policy](../rules/experience-commerce-policy.md).

**Acceptance criteria**

- The server verifies balance, price, and availability.
- Balance and benefit change atomically.
- The purchasing brain cannot alter the published price; an authorized resident provider may propose a price only through a compatible capability and within the applicable server policy.
- Insufficient balance produces a rejection without partial effects.
- The expense appears in the character's financial history.

**Events and metrics:** `credits_spent`, `purchase_rejected`, balance distribution.

**Dependencies:** AIT-402, AIT-902.

### AIT-905 — Reserve job compensation

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As a character considering a job, I want the promised compensation to be reserved before publication so that I cannot accept work the employer is unable to fund.

**Acceptance criteria**

- Paid work cannot be published as `OPEN` without valid funds or budget reserved by the server.
- Reservation does not immediately credit the worker.
- The same funds cannot secure multiple incompatible commitments simultaneously.
- The initial offer expires after 24 world hours unless a different duration was disclosed at publication.
- Acceptance, scheduled start, the two-world-hour start grace window, cancellation, expiration, failure, and release conditions are disclosed before acceptance according to the [job escrow policy](../rules/job-escrow-policy.md).
- Retries do not create duplicate reservations.

**Events and metrics:** `job_escrow_reserved`, `job_escrow_rejected`, `job_offer_expired`, reserved amount and duration.

**Dependencies:** AIT-901, AIT-402.

### AIT-906 — Settle or release reserved compensation

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As a character completing a job, I want to receive reserved compensation according to known rules so that I can trust economic commitments in the world.

**Acceptance criteria**

- Valid completion transfers compensation exactly once.
- Open expiry or cancellation before acceptance refunds 100% to the original funding source.
- Employer cancellation after acceptance but before start pays 20% to the worker and refunds 80%; worker cancellation before start, no-show, or abandonment refunds 100% to the funding source.
- The employer cannot cancel after work starts, and the MVP does not provide partial pay; confirmed Aiterra infrastructure interruption leaves escrow reserved until processing safely resumes.
- Failure, cancellation, and refund follow the versioned [job escrow policy](../rules/job-escrow-policy.md), with distinct job and escrow states.
- Transfer, refund, and job state change atomically.
- Every settlement is correlated with the job and original reservation.
- Disputes are not decided by unverifiable LLM judgment.

**Events and metrics:** `job_escrow_settled`, `job_escrow_refunded`, `job_escrow_split`, `job_cancelled`, `job_failed`, unpaid jobs.

**Dependencies:** AIT-902, AIT-905.

### AIT-907 — Bootstrap an economy without human employers

**Priority:** P0 · **Increment:** B · **Status:** Done

As an operator, I want to fund initial world-controlled opportunities so that early characters can work and meet before an emergent economy exists.

**Acceptance criteria**

- A configurable bootstrap allocation funds a limited set of initial jobs.
- System funds are accounted for separately from character balances.
- Budget, currency creation, and distribution are observable by the operator.
- A limit prevents uncontrolled generation of jobs or credits.
- Bootstrap opportunities favor shared locations useful for social encounters.

**Events and metrics:** credits introduced, completed bootstrap jobs, encounters generated per job.

**Dependencies:** AIT-1001, AIT-905, AIT-906.

### AIT-908 — Complete paid work as a team

**Priority:** P1 · **Increment:** next-pilot · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to join complementary residents in a team job so that work can create coordination, commitments, and consequences that one character cannot produce alone.

**Acceptance criteria**

- The opportunity discloses team size, recruited members, open slots, collective skill coverage, schedule, energy cost, and compensation.
- Each resident explicitly joins; an incomplete team cannot start, and a member can withdraw before formation.
- The server accepts the completed team only when its members collectively cover every required skill threshold.
- Starting validates every member's presence, availability, energy, and temporal compatibility and starts one correlated activity for all members.
- Valid completion settles escrow once and splits the disclosed compensation deterministically across the team.
- Team formation, start, completion, withdrawal, failure, and payout remain reconstructable from authoritative events.

**Events and metrics:** `job_team_member_joined`, `job_team_member_left`, `job_started`, `job_completed`, team formation rate, completed team jobs.

**Dependencies:** AIT-901, AIT-902, AIT-905, AIT-906, configured character skill attributes.

### AIT-909 — Inspect known opportunities on demand

**Priority:** P0 · **Increment:** D · **Status:** In progress

As an external agent, I want to request the detailed opportunity catalog when my character is considering work so that every unrelated decision does not carry all jobs and requirements.

The catalog, selection, delta, and invalidation shape follow the [progressive decision-context contract](../rules/progressive-context-contract.md).

**Acceptance criteria**

- A normal observation exposes a compact versioned opportunity summary, counts, important changes, and the selected or active opportunity rather than the complete detailed catalog.
- An explicit `inspect_opportunities` request returns authorized known jobs, team jobs, and other work opportunities with filtering and stable pagination when required.
- The requested result keeps busy, ineligible, distant, unaffordable, or otherwise blocked known opportunities visible and lists every known blocker, requirement, schedule, duration, Energy cost, compensation, and relevant building or employer context.
- Filtering narrows the requested view only by agent-selected criteria; it never silently converts `blocked` into `unknown` or `absent`.
- Selecting an opportunity retains its relevant details through travel, application, team formation, and start; contract v4 supplies explicit selection/release, three slots, six-world-hour unengaged expiry, and a correlated stale cycle without resending the complete catalog.
- Material publication, withdrawal, fill, expiry, or eligibility changes produce a compact delta or invalidation signal.
- Acceptance and start always revalidate the current authoritative state, and stale selection returns an actionable error without partial effects.

**Events and metrics:** `opportunity_catalog_requested`, `opportunity_context_selected`, `opportunity_context_invalidated`, catalog tokens avoided, selection-to-application rate.

**Dependencies:** AIT-207, AIT-401, AIT-901.

### AIT-910 — Send credits to another resident

**Priority:** P2 · **Increment:** D · **Status:** To do

As an external agent, I want to send some of my character's own credits directly to another resident so that gifts, repayments, tips, and informal splits can create economic ties the world's jobs and prices do not.

**Acceptance criteria**

- The sending brain proposes a recipient and a positive whole amount; the server verifies the sender holds that amount and applies the move atomically, never as a partial effect.
- The credits move from one wallet to the other with no money created or destroyed: the transfer reconciles under the same conservation identity as every other credit movement, through the single wallet mutator.
- A resident cannot send to a character that does not exist, cannot send to themselves, and cannot send zero, a negative, or a fractional amount; each is rejected with an actionable error and no state change.
- The recipient is a resident the sender can address; the server does not let the transfer disclose a private fact about anyone, and does not require the recipient's consent for an incoming credit.
- The move carries an optional free-text note that has no mechanical effect, so a transfer can say why it was made without the server interpreting it.
- The transfer appears in both characters' financial history, correlated to a single authoritative event, and a retried or duplicated proposal moves the credits exactly once.
- The transfer is recorded with the existing `CREDITS_TRANSFERRED` event vocabulary, distinguishable from a wage settlement by carrying no job reference.

**Events and metrics:** `CREDITS_TRANSFERRED` (peer-to-peer, no `jobId`), `transfer_rejected`, transfer volume between residents, share of residents who ever send or receive.

**Dependencies:** AIT-402, AIT-207.

## Out of scope

- a general player-to-player item marketplace;
- resident-created buildings and their operating economy, which are specified in [E14](E14-emergent-city-buildings.md) and [E16](E16-building-operations.md) rather than this bootstrap-economy epic;
- loans, taxes, investments, and advanced inflation;
- final competitive balancing.

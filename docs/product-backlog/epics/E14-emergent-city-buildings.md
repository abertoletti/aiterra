# E14 — Emergent city and agent-authored buildings

**Status:** To do

## Objective

Let autonomous residents reshape the persistent city through freely authored buildings while the server remains authoritative over land, costs, capabilities, quality, and lifecycle.

In this epic, the building proprietor is a character in the world. The human account remains the **owner** defined by the backlog conventions and does not directly operate the building.

## Expected outcome

A resident acquires one or more adjacent cells of the city grid, gives a building its narrative identity, decides what it will deliver and how large it will be, selects valid generic capabilities, pays for construction and upkeep, and creates a new persistent location that can succeed, become inactive, fail, be repurposed, or later change hands.

The server knows the grammar of the building. The external brain invents its meaning.

Two decisions carry the epic's weight, and both are the resident's. Footprint decides how many people the place can hold, and profile decides what it can deliver — priced so that promising everything is unaffordable and a resident has to choose what its place is for.

## Stories

### AIT-1401 — Discover and acquire a buildable plot

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-19)

As an external agent, I want to inspect and acquire a buildable plot on the city grid so that my character can invest in changing the city.

**Acceptance criteria**

- The city is the versioned 20 × 20 grid of the [grammar policy](../rules/building-grammar-policy.md). Every plot is one cell, addressed by its coordinates, and its identity is stable for the life of the world.
- A requested plot catalog discloses coordinates, purchase price, current owner or availability, whether a building occupies it, which footprints the character could legally build there given its own adjacent holdings, and every known blocker.
- Adjacency is disclosed factually. A resident can see which neighbouring cells are free or owned, which is what makes assembling a larger footprint a decision rather than a guess.
- Unaffordable or unavailable plots remain inspectable; their presence does not guarantee acquisition.
- Acquisition revalidates funds, plot availability, and current policy versions. A resident may hold any number of plots.
- Payment and ownership transfer are atomic and idempotent; rejection creates no partial charge or ownership change.
- The external brain cannot declare price, ownership, coordinates, or a mechanical land benefit.
- Price is uniform per cell in grammar version 2. Positional pricing, district modifiers, dynamic land value, and resale remain future scope, and the grid is what makes them addable later without moving anything.

**Events and metrics:** `plots_viewed`, `plot_acquired`, `plot_acquisition_rejected`, occupancy and clustering across the grid.

**Dependencies:** AIT-301, AIT-402, AIT-904, AIT-1006.

### AIT-1402 — Author a building's identity and mechanical profile

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-19)

As an external agent controlling a plot-owning character, I want to name and describe a building, choose its footprint, and decide what it delivers, so that its narrative purpose comes from the resident rather than a developer-authored building type.

**Acceptance criteria**

- The brain may freely propose a bounded name and description, including an invented kind of place.
- It chooses a footprint from the approved set of 1 × 1, 1 × 2, 2 × 1, and 2 × 2 over contiguous cells it already owns, and the server derives capacity from that footprint alone.
- It sets the building's **profile** over the ten controlled dimensions. The profile is what the building delivers, priced convexly rather than capped by a budget: a building can in principle promise everything, and no plausible run of wages can pay for it.
- Because cost is convex in the total promised and neutral about its distribution, a resident must decide **which** dimensions to bet on. Focus is not enforced by a rule; it is what a limited budget buys the most value with, since affinity rewards a profile that matters intensely to some residents over one that mildly suits everyone.
- Tags are derived from the profile, never submitted. Capabilities come from the controlled versioned catalog.
- Free text never creates a mechanical effect, bypasses a requirement, or causes the server to classify the building as a nightclub, church, restaurant, or any other semantic type.
- The brain cannot declare capacity, revenue, attendance, construction cost, upkeep, or future Happiness.
- Before confirmation the proposal discloses the derived construction cost, capacity, and recurring upkeep, so an unaffordable ambition is visible as a number rather than a rejection.
- Invalid footprints, unowned or occupied cells, unknown dimensions, and incompatible capabilities return actionable blockers without re-acquiring a plot, charging the character, or creating a partial building.
- The proposal persists both the free narrative identity and the structured mechanical profile, with their schema and policy versions.

**Events and metrics:** `building_proposed`, `building_proposal_rejected`, footprint distribution, profile concentration, and how the two relate to later attendance.

**Dependencies:** AIT-401, AIT-402, AIT-1401.

### AIT-1403 — Construct and activate a persistent building

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-19)

As an external agent, I want to confirm construction after seeing its authoritative consequences so that my character's investment creates a persistent and mechanically valid place.

**Acceptance criteria**

- Before confirmation, the proposal discloses the server-derived construction cost, duration, capacity, recurring upkeep, and resulting affordances.
- Construction cost derives from the approved formula over footprint and profile, and upkeep derives from that cost, so ambition is both a large purchase and a recurring risk.
- Confirmation revalidates ownership of every cell in the footprint, that no other building occupies them, funds, and the current validity of the structured proposal.
- Construction payment, building creation, and occupation of every cell in the footprint change atomically; a rejected command creates no partial state.
- Completion creates one persistent, reachable world location spanning its cells, with its proprietor, footprint, status, profile, derived tags, capabilities, capacity, and rule versions.
- Capacity derives from footprint and the profile from paid investment, never from promotional text or a client-submitted value.
- Restart and retry cannot create a duplicate building, location, or charge.
- The first capability catalog contains `host_event`, `create_job`, `sell_access`, `sell_service`, and `accept_donation`; later capabilities remain additive and versioned.

**Events and metrics:** `building_construction_started`, `building_activated`, `building_construction_rejected`, construction credits spent against footprint and profile ambition.

**Dependencies:** AIT-301, AIT-302, AIT-402, AIT-403, AIT-1402.

### AIT-1404 — Discover a building and its affordances

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-19)

As an external agent, I want to inspect a building and what is possible there so that I can decide how it relates to my character's preferences and semantic goals.

**Acceptance criteria**

- Every **public** building is discoverable by any resident without a prior visit or invitation, under the [progressive decision-context contract](../rules/progressive-context-contract.md).
- A resident can inspect the building's public name, description, proprietor character, grid position and footprint, capacity, status, controlled profile, derived tags, the character's own affinity with that profile, and currently usable affordances.
- The disclosed profile is also the ceiling on what any experience hosted there can deliver, so a resident can tell what kind of evening the place is capable of before anything is scheduled.
- Public experiences, jobs, services, access conditions, and occupancy are discoverable on demand without embedding all detail in every unrelated decision.
- Affordances describe what can be attempted, not what the brain should choose.
- Financial details remain private to the proprietor and authorized operator unless intentionally published by an allowed action.
- The projection includes only public information or information legitimately learned by the character.
- A narrative label never changes how an affordance is validated mechanically.

**Events and metrics:** `building_viewed`, `building_affordance_viewed`, affordance use by building.

**Dependencies:** AIT-202, AIT-207, AIT-401, AIT-1403.

### AIT-1405 — Fund and pay recurring building upkeep

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-18)

As an external agent controlling a proprietor character, I want to see and fund recurring upkeep so that an unused building becomes a real economic liability instead of a free permanent asset.

**Acceptance criteria**

- Every active building has a disclosed operating balance, upkeep amount, due interval, next due instant, and policy version.
- The proprietor can explicitly and atomically transfer available character credits into the building balance.
- Upkeep is charged exactly once for each due world interval, including after restart recovery.
- Revenue is never fabricated merely because the building exists or characters are nearby.
- Insufficient funds cause an explicit lifecycle transition rather than a hidden debt, negative balance, or silently skipped charge.
- Funding, charges, failures, and resulting state changes remain reconstructable in the building ledger and causal event history.

**Events and metrics:** `building_funded`, `building_upkeep_due`, `building_upkeep_paid`, `building_upkeep_failed`, upkeep coverage rate.

**Dependencies:** AIT-301, AIT-304, AIT-402, AIT-1403.

### AIT-1406 — Experience building inactivity and failure

**Priority:** P1 · **Increment:** D · **Status:** To do

As a proprietor character, I want building failure to follow disclosed and recoverable rules so that economic risk creates consequences without silently erasing prior activity.

**Acceptance criteria**

- Failure follows a versioned lifecycle with explicit states such as `ACTIVE`, `DELINQUENT`, `INACTIVE`, `CLOSED`, and `ABANDONED`; the approved policy defines the exact transitions and grace periods.
- An inactive building cannot publish new activity, sell access, or claim mechanical benefits.
- Existing events, jobs, payments, escrow, and commitments resolve through their governing policies rather than disappearing with the building state change.
- The proprietor receives a useful notification before an avoidable terminal transition and can see valid recovery actions.
- Reactivation revalidates funds and requirements and cannot retroactively erase missed upkeep or consequences.
- Closure and abandonment preserve the location identity, ownership history, ledger, and causal trail.
- No brain can directly declare delinquency, failure, debt, recovery, or abandonment.

**Events and metrics:** `building_delinquent`, `building_inactivated`, `building_reactivated`, `building_closed`, `building_abandoned`, time in lifecycle states.

**Dependencies:** AIT-1405, AIT-603, AIT-604, AIT-906, AIT-1304.

### AIT-1407 — Transfer or repurpose a building

**Priority:** P2 · **Increment:** D/post-MVP · **Status:** To do

As an external agent controlling an eligible character, I want to acquire or repurpose an existing building so that places can accumulate history while their meaning changes over time.

**Acceptance criteria**

- An eligible building can be transferred through an authoritative, atomic, and idempotent transaction under the approved lifecycle policy.
- A proprietor may propose a new narrative identity and a new valid structured profile or capability mix without rewriting the building's prior identity or outcomes.
- Repurposing may require disclosed investment, time, and temporary inactivity and changes only future affordances.
- Ownership, narrative revisions, capability versions, and prior outcomes remain reconstructable.
- Open commitments, escrow, balances, and access rights are resolved or explicitly transferred before ownership changes.
- Dynamic land-value speculation, loans, auctions, equity, and forced-sale design are outside the first implementation unless a later policy explicitly adds them.

**Events and metrics:** `building_transferred`, `building_repurpose_started`, `building_repurposed`, reused buildings.

**Dependencies:** AIT-402, AIT-904, AIT-1402, AIT-1406.

## Out of scope

- semantic server code for specific place types such as nightclubs, churches, restaurants, gyms, or theaters;
- arbitrary executable mechanics supplied in free text;
- furniture and graphical interior editing;
- dynamic land pricing and speculative property markets in the first implementation;
- loans, mortgages, auctions, equity, franchising, securities, and complex tax or accounting systems.

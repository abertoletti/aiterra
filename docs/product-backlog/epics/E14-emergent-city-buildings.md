# E14 — Emergent city and agent-authored buildings

**Status:** To do

## Objective

Let autonomous residents reshape the persistent city through freely authored buildings while the server remains authoritative over land, costs, capabilities, quality, and lifecycle.

In this epic, the building proprietor is a character in the world. The human account remains the **owner** defined by the backlog conventions and does not directly operate the building.

## Expected outcome

A resident acquires a plot, gives a building its narrative identity, selects valid generic capabilities, pays for construction and upkeep, and creates a new persistent location that can succeed, become inactive, fail, be repurposed, or later change hands.

The server knows the grammar of the building. The external brain invents its meaning.

## Stories

### AIT-1401 — Discover and acquire a buildable plot

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-18)

As an external agent, I want to inspect and acquire a known buildable plot so that my character can invest in changing the city.

**Acceptance criteria**

- A requested plot catalog discloses district, location, size, purchase price, capacity constraints, configured district modifiers, availability, and every known blocker.
- Unaffordable or currently unavailable plots remain inspectable; their presence does not guarantee acquisition.
- Acquisition revalidates ownership limits, funds, plot availability, and current policy versions.
- Payment and ownership transfer are atomic and idempotent; rejection creates no partial charge or ownership change.
- The external brain cannot declare price, ownership, district properties, or a mechanical land benefit.
- Initial district and plot properties are configured and versioned according to the [building grammar policy](../rules/building-grammar-policy.md); dynamic land-value speculation remains future scope.

**Events and metrics:** `plots_viewed`, `plot_acquired`, `plot_acquisition_rejected`, plots acquired by district.

**Dependencies:** AIT-301, AIT-402, AIT-904, AIT-1006.

### AIT-1402 — Author a building's identity and mechanical profile

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-18)

As an external agent controlling a plot-owning character, I want to name and describe a building and select valid generic capabilities so that its narrative purpose comes from the resident rather than a developer-authored building type.

**Acceptance criteria**

- The brain may freely propose a bounded name and description, including an invented kind of place.
- It selects tags, profile dimensions, and capabilities only from controlled, versioned catalogs.
- Mechanical profiles use budgets, bounds, prerequisites, and compatibility rules; selecting every positive dimension or capability at maximum is impossible.
- Free text never creates a mechanical effect, bypasses a requirement, or causes the server to classify the building as a nightclub, church, restaurant, or any other semantic type.
- The brain cannot declare quality, capacity, revenue, attendance, construction cost, upkeep, or future Happiness.
- Invalid combinations return actionable blockers without acquiring the plot again, charging the character, or creating a partial building.
- The proposal persists both the free narrative identity and the structured mechanical profile, with their schema and policy versions.

**Events and metrics:** `building_proposed`, `building_proposal_rejected`, selected capability and profile distribution.

**Dependencies:** AIT-401, AIT-402, AIT-1401.

### AIT-1403 — Construct and activate a persistent building

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-18)

As an external agent, I want to confirm construction after seeing its authoritative consequences so that my character's investment creates a persistent and mechanically valid place.

**Acceptance criteria**

- Before confirmation, the proposal discloses the server-derived construction cost, duration, capacity, initial quality, recurring upkeep, and resulting affordances.
- Confirmation revalidates plot ownership, funds, construction limits, and the current validity of the structured proposal.
- Construction payment, building creation, and plot occupation change atomically; a rejected command creates no partial state.
- Completion creates one persistent, reachable world location with its proprietor, plot, status, profile, capabilities, and rule versions.
- Quality derives from verified investment and policy inputs, never from promotional text or a client-submitted quality value.
- Restart and retry cannot create a duplicate building, location, or charge.
- The first capability catalog contains `host_event`, `create_job`, `sell_access`, `sell_service`, and `accept_donation`; later capabilities remain additive and versioned.

**Events and metrics:** `building_construction_started`, `building_activated`, `building_construction_rejected`, construction credits spent.

**Dependencies:** AIT-301, AIT-302, AIT-402, AIT-403, AIT-1402.

### AIT-1404 — Discover a building and its affordances

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-18)

As an external agent, I want to inspect a known building and what is possible there so that I can decide how it relates to my character's preferences and semantic goals.

**Acceptance criteria**

- A resident can inspect the building's public name, description, proprietor character, district, capacity, quality, status, controlled profile, tags, and currently usable affordances.
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

# E11 — Energy and recovery

**Status:** In progress

## Objective

Use energy as a character resource to create choices and needs while keeping it distinct from time, which continues to pass in the world.

## Expected outcome

Work, study, and experiences consume energy according to server rules; event attendance combines a meaningful participation cost with a lower duration cost, while rest and other activities recover Energy without turning every social interaction into a heavy tax.

## Stories

### AIT-1101 — Observe current energy

**Priority:** P0 · **Increment:** A · **Status:** Done

As an external agent, I want to know current energy, capacity, and recovery factors so that I can plan realistic activities.

**Acceptance criteria**

- Energy is a server-authoritative value within configured limits.
- The observation distinguishes energy from time and shows any known modifiers.
- The client cannot independently assign or correct the value.
- Every significant change is linked to a valid activity or event.

**Events and metrics:** `energy_changed`, energy distribution.

**Dependencies:** AIT-202.

### AIT-1102 — Spend energy on activities

**Priority:** P0 · **Increment:** A–B · **Status:** In progress

**Specification:** Updated (2026-08-18)

As an external agent, I want to know the expected energy cost of an activity so that I can consciously choose work, study, or event attendance.

**Acceptance criteria**

- The server determines the cost of work, training, experiences, and other primary activities according to an attributed policy version.
- Experience attendance distinguishes an initial participation cost, a lower marginal duration cost, and additional interaction or contributor activity costs rather than using duration multiplied by one constant.
- An activity is rejected if energy does not meet the minimum requirement.
- The actual cost is applied at most once.
- Interruption consequences follow an explicit rule.
- The cost shown before the action does not guarantee acceptance if state changes.

**Events and metrics:** `energy_spent`, activities rejected because of energy.

**Dependencies:** AIT-401, AIT-403, AIT-1101.

### AIT-1103 — Recover energy by resting

**Priority:** P0 · **Increment:** A · **Status:** Done

As an external agent, I want to propose that the character rest so that it recovers energy while giving up availability for other activities during that period.

**Acceptance criteria**

- The server determines duration and expected recovery.
- The character cannot perform incompatible primary activities while resting.
- Recovery is applied progressively or on completion according to one testable rule.
- Energy does not exceed valid capacity.
- A compatible event can be perceived without automatically canceling rest.

**Events and metrics:** `rest_started`, `rest_completed`, recovered energy.

**Dependencies:** AIT-301, AIT-303, AIT-1101.

### AIT-1104 — Keep social interactions lightweight

**Priority:** P1 · **Increment:** B · **Status:** Done

As an owner, I want talking and greeting to have a low or contextual energy cost so that the behavior generating MVP stories is not discouraged.

**Acceptance criteria**

- A greeting or short conversation does not consume as much energy as a primary activity.
- Any social costs are configurable and bounded.
- A low-energy character can still perform defined minimal social reactions.
- Metrics show whether energy reduces interactions excessively.

**Events and metrics:** interactions rejected because of energy, average cost per conversation.

**Dependencies:** AIT-502, AIT-503, AIT-1102.

### AIT-1105 — Spend Energy for actual experience participation

**Priority:** P1 · **Increment:** D · **Status:** In progress

As an external agent, I want to see and pay the Energy cost of the time and activities my character actually spends in an experience so that brief attendance is possible but cannot exploit a near-zero entry cost.

**Acceptance criteria**

- The estimate separates a meaningful initial participation cost from a lower configurable marginal duration curve.
- Actual duration cost uses authoritative presence from entry until departure or terminal experience end, not the advertised full duration when the character leaves early.
- Joining for a very short period still charges the initial cost exactly once; re-entry rules and any repeated initial charge are explicit.
- Conversations, arguments, performing, working, and other activities may add disclosed contextual Energy costs, so co-present residents can finish with different Energy.
- Entry is rejected without partial charge when minimum Energy is unavailable; subsequent optional activity is independently revalidated.
- Retry, restart, late event processing, and duplicate presence events cannot duplicate or omit an Energy charge.
- Exact base, curve, rounding, re-entry, and additional activity values require an approved [experience Energy policy](../rules/experience-energy-policy.md).

**Events and metrics:** `experience_energy_started`, `experience_energy_accrued`, `experience_activity_energy_spent`, Energy by duration and activity, short-stay rate.

**Dependencies:** AIT-301, AIT-304, AIT-1101, AIT-1102.

**Current delivery note:** Entry and marginal presence Energy are configurable, disclosed, charged from authoritative attendance exactly once, capped, replay-safe, and covered for partial attendance and terminal resolution. The re-entry discount is implemented but lacks a dedicated protocol test, while contributor/performance and argument-intensity additions remain outside the approved version-1 scope.

## Out of scope

- detailed biological needs;
- illness and medicine;
- minute-by-minute metabolism simulation.

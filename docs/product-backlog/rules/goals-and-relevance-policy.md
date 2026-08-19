# Goals and event relevance policy

**Version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-102, AIT-104, AIT-602

## Goal classes

Goal class and priority are separate concepts.

### Primary goal

- Authored by the owner as long-term strategic direction.
- At most one is active in the MVP.
- Has a structured type, target when applicable, low, medium, or high priority, and optional free-text guidance.
- Does not expire unless the owner supplied an expiry and can be changed prospectively through AIT-103.

### Secondary goal

- Proposed by the external brain because of a perceived `sourceEventId`.
- At most three are active in the MVP.
- Uses one of the initial structured types: `strengthen_relationship`, `avoid_character`, `attend_event`, `resolve_conflict`, `visit_location`, or `find_work`.
- Identifies a known target when the type requires one, a low, medium, or high priority, an optional declared reason, and an expiry.
- Expires after seven world days by default, or when a referenced event becomes impossible, whichever is earlier.

The server accepts a secondary goal only when its source was perceived, its target is known and valid, its shape is allowed, capacity remains, and no equivalent active goal exists. Acceptance records the goal as canonical state but does not force the brain to act or grant a direct benefit. Completion requires authoritative evidence; abandonment is explicit; expired and abandoned goals remain in history.

Free text guides the external brain only. The server never parses free-text personality, rationale, or goal text to assign mechanical relevance.

Goal relevance determines whether a perceptible event can wake the brain under this policy. It is not Goal Alignment, Expected Happiness, or Realized Happiness, and no goal score is an input to the Experience/Happiness formula.

## Relevance calculation

Perceptibility is a hard gate. If the character could not perceive the event, its relevance is `NONE` regardless of goals or strategic usefulness.

For a perceptible event, the server adds these non-stacking factors:

| Factor | Score |
| --- | ---: |
| Same social area | +25 |
| Known relationship | +20 |
| Strong relationship | +40 instead of +20 |
| Character is a direct target or participant | +50 |
| Compatible with current activity | +5 |
| Event type is configured as important | +5 |

A relationship is strong when `max(abs(affinity), abs(trust), tension) >= 60`.

Only the highest matching goal contributes:

| Goal match | Primary | Secondary |
| --- | ---: | ---: |
| Exact target or outcome match | +30 | +20 |
| Contextual match | +20 | +10 |
| High-priority modifier | +10 | +10 |
| Medium-priority modifier | +5 | +5 |
| Low-priority modifier | 0 | 0 |

The total goal contribution is capped at 40 for a primary goal and 30 for a secondary goal. Multiple goals never stack. Avoidance and conflict goals count as relevant even though the likely reaction may be withdrawal or refusal.

The total score is capped at 100:

- `LOW`: 0–29;
- `MEDIUM`: 30–59;
- `HIGH`: 60–100 and eligible for wake-up.

Urgency is a separate event attribute. Only an authoritative event class with an urgent or irreversible deadline can be `CRITICAL`; a goal match can never promote an event to `CRITICAL`.

For every evaluation the server persists the total, each factor, the selected goal and match type when present, threshold, relevance result, urgency, and `relevanceRuleVersion`.

Example: Sara enters the same party as a character who knows her and has a high-priority secondary goal to strengthen that relationship: `25 + 20 + 20 + 10 = 75`, producing `HIGH` relevance.

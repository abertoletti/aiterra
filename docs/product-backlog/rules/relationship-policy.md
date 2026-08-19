# Directional relationship policy

**Version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-701, AIT-703

## Model and authority

A relationship is directional. `Alice → Luca` describes Alice's relationship toward Luca and is private from Luca; `Luca → Alice` is an independent edge.

After the first valid contact, the edge starts at:

```json
{
  "affinity": 0,
  "trust": 0,
  "tension": 0
}
```

An absent edge means the characters have no valid known relationship; it is not equivalent to a known neutral edge.

- `affinity`: -100 to 100; subjective attraction, enjoyment, or aversion.
- `trust`: -100 to 100; evidence-based expectation of reliability.
- `tension`: 0 to 100; active discomfort, rivalry, conflict, or unresolved pressure. High tension can coexist with high affinity.

The brain that owns the directional edge may choose a structured appraisal such as `appreciated`, `neutral`, `uncomfortable`, or `offended`. It never submits numeric values. The server validates the appraisal and maps it to bounded deltas. The acting character cannot choose how another character feels.

Authoritative outcomes can apply mandatory base deltas without interpreting free text. Trust never increases merely because an agent labels a statement believable.

## Initial resolution table

Every row applies to the directional edge named in the second column. Values are initial calibration values, not agent input.

| Verified event or appraisal | Directional edge | Affinity | Trust | Tension |
| --- | --- | ---: | ---: | ---: |
| Greeting appraised `appreciated` | perceiver → greeter | +1 | 0 | 0 |
| Qualifying interaction appraised `appreciated` | perceiver → other participant | +2 | 0 | 0 |
| Completed help | beneficiary → helper | +1 | +3 | 0 |
| Rejection appraised `uncomfortable` | rejected → rejecting | -1 | 0 | +2 |
| Insult appraised `offended` | recipient → speaker | -3 | 0 | +5 |
| Lie authoritatively discovered | discoverer → liar | -1 | -6 | +3 |
| Promise kept | beneficiary → promisor | +1 | +4 | -1 |
| Promise broken | beneficiary → promisor | -2 | -8 | +4 |
| Expected-response silence | waiting participant → silent participant | -1 | -1 | +1 |

Values are clamped after applying a delta. Tension cannot fall below zero. There is no passive relationship decay in the MVP.

The explicit appraisals `neutral` and a valid decision not to assign a subjective reaction create no subjective delta, but mandatory objective outcomes still apply.

## Compatibility notice for the emergent-city increment

Version 1 above is the already delivered Release 0 contract and is not silently redefined. It never authorizes server-side semantic interpretation of free conversation text, but its generic objective-outcome entry point is superseded prospectively by the draft [evidence-safe relationship policy version 2](relationship-policy-v2.md) in AIT-707. Version-1 historical outcomes retain version 1, and new subjective annotations never invoke the legacy objective rules.

## Attribution and anti-farming

Every `relationship_changed` event records character and counterpart IDs, dimension, previous value, delta, resulting value, source type (`subjective_appraisal`, `objective_outcome`, or `silence`), source event, appraisal when present, and `relationshipRuleVersion`.

For positive subjective affinity from the same action category and pair during one world day, the first qualifying change receives 100% of its configured value, the second receives 50%, and later repetitions receive 0%. Objective trust outcomes are not farmable through conversation labels. A relationship value does not directly mint credits, reputation, or score.

The prototype's former scalar relationship value migrates into `affinity`, clamped to its range; `trust` and `tension` start at zero. The migration emits its own versioned event rather than rewriting history.

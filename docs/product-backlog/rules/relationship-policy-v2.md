# Evidence-safe directional relationship policy

**Status:** Draft · **Candidate version:** 2 · **Updated:** 2026-08-18 · **Applies to:** AIT-707

This draft is the prospective successor to the approved [directional relationship policy version 1](relationship-policy.md). It does not change or relabel any historical version-1 outcome.

## Fixed product decisions

- The directional relationship model, bounds, server-owned deltas, provenance, and anti-farming principles remain compatible with version 1 unless an approved migration explicitly changes a value.
- `suspected_lie` is private character-owned interpretation. It never invokes an objective relationship rule.
- The world may authoritatively link a structured claim to corroborating or contradictory evidence without declaring deception.
- Objective deception requires all of: a structured claim, authoritative evidence that the claim was false, authoritative evidence that the speaker's character-known state contradicted it when stated, and valid perceptibility by the affected character.
- Free conversation text, a listener's confidence, a later disagreement, or falsity without proven contradictory knowledge is insufficient for objective deception.
- Objective kept or broken promise outcomes require a formal server-authoritative commitment created through explicit agreement and resolved by its lifecycle.
- `perceived_promise` on informal dialogue never becomes a formal commitment or invokes an objective promise delta.
- A client cannot select the objective rule, evidence result, attribution, or numeric delta.
- Historical events retain `relationshipRuleVersion=1`; only outcomes created after activation use version 2.

## Required decisions before version 2 approval

1. Structured claim schema and which authoritative facts can establish falsity and speaker knowledge.
2. Evidence visibility, uncertainty, correction, appeal exclusion, and insufficient-proof outcomes.
3. Whether version-1 numeric deception and formal-commitment deltas remain unchanged.
4. Exact event and rule names, protocol compatibility, and migration activation instant.
5. Idempotency and duplicate-evidence handling.
6. Tests proving that subjective annotations and free text cannot reach objective rules.


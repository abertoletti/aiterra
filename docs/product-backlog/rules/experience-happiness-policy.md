# Experience and Happiness policy

**Status:** Draft · **Candidate version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-1203, AIT-1501, AIT-1503, AIT-1505, AIT-1506, AIT-1507, AIT-1508, AIT-1509, AIT-1601, AIT-1606, AIT-1609

This draft records the invariant shape of the Experience Engine. It deliberately does not approve numeric balancing values yet.

## Fixed product decisions

- Happiness is bounded and server-authoritative, distinct from Credits, Energy, skills, relationships, popularity, reputation, and goals.
- Characters and experiences use the same controlled universal profile dimensions owned and versioned by the [city, building, and experience grammar policy](building-grammar-policy.md). This policy supplies normalization and value rules but never redefines that taxonomy. The server does not contain a special Happiness rule for a nightclub, church, dinner, festival, class, or other semantic description.
- Expected Happiness is an explainable uncertain estimate based only on what the character can know. It is not a guaranteed reward or an action recommendation.
- Realized Happiness uses what actually happened and can be positive, neutral, or negative.
- Presence of a valued person can increase expectation as an opportunity. Material realized social value requires verified interaction.
- Expected attendee identity is usable only when the RSVP is public or the character legitimately learned it; private commitments remain hidden and may contribute at most an authorized aggregate or uncertainty term.
- Social value considers directional relationship importance, interaction intensity, structured appraisal or authoritative outcome, and novelty.
- Contributor value uses verified relevant skill, Domain Reputation, relevance, and actual participation. A narrative role label has no special formula.
- Known venue quality may contribute one bounded Expected and Realized factor; it never guarantees attendance or a positive outcome and may carry higher upkeep through the building economy policy.
- Venue repetition and experience-profile repetition are distinct. Every repeatable source has diminishing returns and anti-duplication bounds.
- Free descriptions remain visible to the external brain for semantic interpretation but produce no direct numeric factor.
- Goal Alignment and semantic goal text are not Happiness inputs. The brain decides strategic relevance independently.
- The first active version must include at least one server-authoritative neglect pressure that can lower Happiness for a persistently work-only or experience-avoiding character; passive decay is one candidate, but the policy may choose a bounded work or overwork cost or another universal mechanism.
- Ignoring low Happiness must then have at least one bounded material consequence; neither the pressure nor the consequence is numerically approved yet.

## Required decisions before version 1 approval

1. Happiness range, initial distribution, saturation function, and rounding.
2. Preference ranges, profile budgets, normalization, and initialization against the taxonomy selected by the grammar policy.
3. Base experience value and relative weights for affinity, social value, contributor value, crowd context, novelty, and repetition.
4. Interaction-intensity and appraisal mapping without server-side LLM classification.
5. Contributor relevance, performance-quality calculation, and the separate bounded venue-quality factor.
6. Venue and experience similarity functions, history windows, caps, and diminishing returns.
7. Expected range, uncertainty model, explanation, disclosure level, RSVP visibility, and consent rules.
8. Realized resolution time, partial attendance treatment, and factor attribution.
9. Mandatory neglect-pressure mechanism; if passive decay is selected, its interval and rate, otherwise the exact activity-linked trigger and cost.
10. Low-Happiness consequence, bands, recovery behavior, and whether Happiness contributes to Score.
11. Reward-hacking and collusion protections across interactions, attendance, contributors, and repeated experiences.

The `0–100` Happiness range discussed during design is the leading calibration candidate, not an approved value. Passive decay and Score participation both require explicit decisions; passive decay may be declined only when another approved mechanism supplies the mandatory neglect pressure.

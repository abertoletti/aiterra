# Versioned product rules

These documents contain cross-story product decisions. A story remains the unit of product value; an approved rule supplies the precise policy or contract needed to make that story Ready. Draft policies preserve decided invariants and explicitly list the calibration still required; they are not active game rules and cannot be used to mark a dependent story Done.

A policy may be approved for part of its subject when a vertical slice needs that part and the rest would be guesswork. Its **Scope** line states what the approved version covers, the policy lists what stays Draft, and a story depending on the deferred part remains blocked. Several entries below are intentionally scoped this way.

## Approved policies

| Rule | Version | Stories |
| --- | --- | --- |
| [Character name policy](character-name-policy.md) | 1 | AIT-101 |
| [Interaction timing and silence policy](interaction-timing-policy.md) | 1 | AIT-204, AIT-205, AIT-503, AIT-504, AIT-603, AIT-604 |
| [Goals and relevance policy](goals-and-relevance-policy.md) | 1 | AIT-102, AIT-104, AIT-602 |
| [Relationship policy](relationship-policy.md) | 1 | AIT-701, AIT-703 |
| [Owner-feed pagination contract](owner-feed-pagination-contract.md) | 1 | AIT-801 |
| [Job escrow policy](job-escrow-policy.md) | 1 | AIT-905, AIT-906, AIT-1602, AIT-1603, AIT-1607 |
| [Product metrics dictionary](product-metrics-dictionary.md) | 1 | AIT-1002 |
| [Progressive decision-context contract](progressive-context-contract.md) | 4 | AIT-207, AIT-909, AIT-1404, AIT-1502, AIT-1510 |
| [Subjective claims and promises policy](subjective-memory-policy.md) | 1 | AIT-705, AIT-706, AIT-707 |
| [City, building, and experience grammar policy](building-grammar-policy.md) | 3 · atomic ground claims with legacy purchase compatibility | AIT-1401, AIT-1402, AIT-1403, AIT-1501, AIT-1505, AIT-1510 |
| [Building economy and lifecycle policy](building-economy-lifecycle-policy.md) | 1 · wallet upkeep, recovery, failure and existing obligations | AIT-1401, AIT-1403, AIT-1405, AIT-1406 |
| [Experience and Happiness policy](experience-happiness-policy.md) | 2 · observation, attendance, realized value, expectation ownership | AIT-1501, AIT-1503, AIT-1505, AIT-1510 |
| [Experience Energy policy](experience-energy-policy.md) | 1 · participation and duration | AIT-1504 |
| [Experience commerce policy](experience-commerce-policy.md) | 1 · paid access | AIT-1504 |
| [Course and skill progression policy](course-skill-progression-policy.md) | 1 | AIT-1201, AIT-1205 |
| [Domain Reputation policy](domain-reputation-policy.md) | 1 · work-skill domains and organizer general reputation | AIT-1202, AIT-1603, AIT-1608 |

Changing a rule requires a new version, a compatibility or migration decision, and updated acceptance tests. Historical events retain the version that resolved them.

## Policies awaiting approval

| Draft policy | Status | Stories | Main decisions still required |
| --- | --- | --- | --- |
| [Evidence-safe directional relationship policy](relationship-policy-v2.md) | Draft | AIT-707 | structured deception proof, formal promises, migration, compatibility |
| [Progression score policy](score-policy.md) | Draft · `livedHappiness` inclusion decided | AIT-1203, AIT-1204 | normalization, weights and the `livedHappiness` transform, wealth, relationship and reputation aggregation, achievements |
| [City grammar: districts, quality, repurposing](building-grammar-policy.md) | Draft beyond v3 | AIT-1006, AIT-1407, AIT-1602, AIT-1609 | district modifiers, dynamic land value, capability prerequisites, whether quality survives as a separate value, name safety, repurposing |
| [Building economy: transfer, repurposing and quality](building-economy-lifecycle-policy.md) | Draft beyond v1 | AIT-1407, AIT-1605, AIT-1607, AIT-1609 | transfer, terminal reopening, generic-operation settlement, quality investment |
| [Happiness: novelty, contributors, collusion](experience-happiness-policy.md) | Draft beyond v2 | AIT-1506–AIT-1509 | novelty reward, finer profile similarity, contributor value, venue quality, RSVP visibility, collusion |
| [Experience Energy: contributor and performance costs](experience-energy-policy.md) | Draft beyond v1 | AIT-1102, AIT-1105, AIT-1604, AIT-1606 | contributor, performance and argument additions, forced termination |
| [Experience commerce: services, donations, settlement](experience-commerce-policy.md) | Draft beyond v1 | AIT-904, AIT-1601, AIT-1605–AIT-1607 | services, donations, operating cost, settlement order, fees |
| [Domain Reputation: experience-domain extension](domain-reputation-policy.md) | Draft beyond v1 | AIT-1503, AIT-1508, AIT-1604, AIT-1608 | experience-profile domains, contributor quality, separate contributor/organizer attribution, expectation use |
| [Emergent-city metrics dictionary](emergent-city-metrics-dictionary.md) | Draft | AIT-1007 | units, denominators, windows, attribution, anti-hacking reporting |

Before implementation starts on a dependent story, its draft policy must be reviewed, assigned an approved version, supplied with concrete values and compatibility behavior, and covered by acceptance tests. Approval must update both the policy header and this index.

# Progression score policy

**Status:** Draft · **Candidate version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-1203, AIT-1204

This draft defines how an optional comparative score summarizes independent mechanics without replacing them.

## Fixed product decisions

- Score is non-spendable and remains distinct from Credits and every underlying component.
- The formula is server-authoritative, versioned, explainable, and based only on authoritative component state and achievements.
- Wealth, relationships, skills, popularity, general or Domain Reputation, and achievements are eligible components; every included component is shown separately.
- Happiness is always visible independently. It contributes to Score only if both the approved Happiness policy and this policy select a bounded weight.
- Diminishing returns and component caps prevent one dimension from dominating without limit.
- Changing a formula version never rewrites Credits, Happiness, skills, relationships, reputation, popularity, achievements, or historical scores attributed to an older version.
- Comparisons identify formula version, interval, eligibility, environment, and test-character treatment.

## Required decisions before version 1 approval

1. Component normalization, weights, caps, diminishing-return functions, and rounding.
2. Wealth definition and treatment of building balances, assets, upkeep liabilities, and realized losses.
3. Relationship aggregation without exposing private reverse edges.
4. Domain Reputation aggregation and whether general reputation is separate.
5. Happiness inclusion decision and compatibility with its policy version.
6. Achievement catalog, time windows, leaderboard eligibility, and formula migration behavior.


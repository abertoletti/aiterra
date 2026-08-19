# Progression score policy

**Status:** Draft · **Candidate version:** 1 · **Updated:** 2026-08-19 · **Applies to:** AIT-1203, AIT-1204

This draft defines how an optional comparative score summarizes independent mechanics without replacing them.

## Fixed product decisions

- Score is non-spendable and remains distinct from Credits and every underlying component.
- The formula is server-authoritative, versioned, explainable, and based only on authoritative component state and achievements.
- Wealth, relationships, skills, popularity, general or Domain Reputation, and achievements are eligible components; every included component is shown separately.
- Diminishing returns and component caps prevent one dimension from dominating without limit.
- Changing a formula version never rewrites Credits, Happiness, skills, relationships, reputation, popularity, achievements, or historical scores attributed to an older version.
- Comparisons identify formula version, interval, eligibility, environment, and test-character treatment.

## Decided: Happiness enters Score as `livedHappiness`

The [experience and Happiness policy](experience-happiness-policy.md) version 2 splits Happiness into a bounded state and an unbounded lived total. This policy selects **`livedHappiness`** as the Score component, and excludes the bounded `happiness` state.

- `livedHappiness` is a Score component with a bounded weight.
- The bounded `happiness` state is **not** a component. It stays independently visible, as does the lived total.
- The component enters through a **concave, monotonic** transform with no hard cap: more lived experience always scores more, and each additional unit scores less. An unbounded raw total cannot be admitted linearly beside bounded components without eventually swamping them.
- Score is where ignoring Happiness costs a resident something. The Happiness policy deliberately carries no low-Happiness debuff and points here instead, so this inclusion is a load-bearing dependency rather than a display preference. Removing it would leave that requirement unsatisfied and reopen AIT-1509.

Which quantity to use is the whole decision, and the two are not interchangeable. The bounded state answers *how is this resident doing right now*, which is the wrong question to rank a run on: every resident converges toward the middle of a saturating range, so the differences compress into noise, and a single good evening timed just before the count would move it as much as a season of living well. The lived total is a record of the entire run that cannot be recovered late.

The exact weight and the transform's parameters are **not** decided here. They arrive with component normalization below, because a single component's weight has no meaning until the others are on a common scale.

## Required decisions before version 1 approval

1. Component normalization, weights, caps, diminishing-return functions, and rounding, including the `livedHappiness` transform's parameters and its bounded weight.
2. Wealth definition and treatment of building balances, assets, upkeep liabilities, and realized losses.
3. Relationship aggregation without exposing private reverse edges.
4. Domain Reputation aggregation and whether general reputation is separate.
5. Achievement catalog, time windows, leaderboard eligibility, and formula migration behavior.

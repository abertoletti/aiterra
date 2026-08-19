# City, building, and experience grammar policy

**Version:** 1 · **Scope:** the shared profile taxonomy only · **Updated:** 2026-08-19 · **Applies to:** AIT-1006, AIT-1401, AIT-1402, AIT-1403, AIT-1404, AIT-1407, AIT-1601, AIT-1602, AIT-1605, AIT-1609

Version 1 approves **only** decisions 3 and 4: the controlled universal profile dimensions shared by character preferences, experiences, and later buildings, and their budget and normalization rules. That is the subset the Experience and Happiness slice needs, and approving it lets Happiness reference a versioned taxonomy instead of inventing one.

Districts, plots, building capabilities, capacity, quality derivation, naming rules, and repurposing remain **Draft** and are listed at the end. A story that depends on those parts is still blocked.

## Fixed product decisions

- The city contains versioned districts and buildable plots. A plot has district, location, size, availability, owner when acquired, purchase price, and mechanical constraints.
- A building has proprietor character, plot, free name and description, controlled profile and tags, generic capabilities, capacity, construction cost, recurring upkeep, server-derived quality, lifecycle status, and creation versions.
- The brain freely authors the narrative identity. The server never needs to decide that a building is a nightclub, church, restaurant, gym, theater, or another semantic type.
- Free text cannot create mechanics. Tags, profile dimensions, and capabilities come from controlled catalogs with bounds, budgets, prerequisites, and compatibility rules.
- This policy is the single source of truth for the controlled universal profile-dimension and tag taxonomy shared by character preferences, buildings, and experiences. Happiness policies reference its version and weights; they do not redefine the taxonomy.
- Affordances state what can be attempted; they do not prescribe an action.
- The initial capability catalog is `host_event`, `create_job`, `sell_access`, `sell_service`, and `accept_donation`.
- `produce_item`, `store_item`, `rent_space`, and other capabilities require a later policy version and supporting stories.
- Capacity and quality are authoritative derived values. A client cannot claim them through description or tags, and quality must have at least one bounded disclosed mechanical use rather than remain a cosmetic number.
- District properties can differ without assigning a semantic destiny to a district. Emergent concentration of activity is an outcome, not configuration text interpreted as a rule.

## Approved: the universal profile dimensions

Six dimensions, `profileTaxonomyVersion: 1`. They describe what a place or a gathering *does to a person*, never what it is called. The same six describe a character's preferences, so affinity is a comparison of like with like.

| Dimension | What it measures |
| --- | --- |
| `social` | being among other people |
| `stimulation` | intensity, noise, novelty, excitement |
| `calm` | quiet, rest, reflection |
| `creation` | making, performing, building something |
| `learning` | acquiring knowledge or skill |
| `belonging` | ritual, shared identity, community membership |

The taxonomy is deliberately semantic-free. A nightclub is whatever profile its author gives it — plausibly high `social` and `stimulation`; a church might be high `belonging` and `calm`; a workshop high `creation` and `learning`. The server never learns those words, and two residents may author places with the same profile and completely different meaning.

Adding, removing, or renaming a dimension requires a new taxonomy version, because every stored preference vector and experience profile is expressed in it.

## Approved: budgets, normalization, and validation

| Rule | Value |
| --- | ---: |
| Dimension value range | 0–100, integer |
| Character preference budget | dimensions sum to exactly 300 |
| Experience profile budget | dimensions sum to exactly 100 |
| Missing dimension | treated as 0, but the budget must still be met |
| Unknown dimension name | rejected, never ignored |

A character's preference budget of 300 over six dimensions means an average of 50: a resident can care intensely about two or three things, not about everything. That is what makes one experience better for Mira than for Rook, and it is why affinity discriminates at all.

An experience profile sums to 100 and is therefore read as a distribution: an experience is a mix of what it offers, and `weight_d = profile_d / 100`.

Affinity between a character and an experience is the weighted preference:

```text
affinity = Σ_d ( profile_d / 100 ) × preference_d        → 0–100
```

Both vectors are server-owned. A brain may author free description and may not submit, adjust, or opportunistically retune either vector; preference changes require the explicit versioned rules of the Happiness policy.

## Still Draft: everything else

Decisions 1, 2, and 5 through 8 remain unapproved: the district list and its land-price, upkeep, traffic, prestige, size and capacity modifiers; plot sizes, supply and ownership limits; capability prerequisites and exclusivity; capacity and quality derivation and upgrade paths; name and description safety; and repurposing compatibility across grammar versions.

AIT-1401 through AIT-1403, AIT-1407, and the building-dependent parts of AIT-1601, AIT-1602, AIT-1605, and AIT-1609 stay blocked until those receive a version 2.

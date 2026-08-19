# City, building, and experience grammar policy

**Status:** Draft · **Candidate version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-1006, AIT-1401, AIT-1402, AIT-1403, AIT-1404, AIT-1407, AIT-1601, AIT-1602, AIT-1605, AIT-1609

This draft describes how agents author meaning inside a bounded mechanical grammar. It is not an active versioned rule until version 1 is approved.

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

## Required decisions before version 1 approval

1. Initial district list and static land price, upkeep, traffic-potential, prestige, size, and capacity modifiers.
2. Plot sizes, supply, acquisition limits, and ownership limits.
3. Controlled universal profile dimensions and tag taxonomy shared by preferences, buildings, and experiences.
4. Profile budget, normalization, compatibility, and validation rules.
5. Capability prerequisites, mutually exclusive combinations, and per-building limits.
6. Capacity and initial quality derivation, controlled upgrade paths, bounds, and compatible mechanical effects.
7. Name and description safety, size, uniqueness, and moderation constraints.
8. Repurposing constraints and compatibility behavior across grammar versions.

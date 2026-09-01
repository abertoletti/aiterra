# City, building, and experience grammar policy

**Version:** 3 · **Scope:** the shared profile taxonomy, tags, city grid, atomic ground claims, footprints, capacity, and construction cost · **Updated:** 2026-08-26 · **Applies to:** AIT-1006, AIT-1401, AIT-1402, AIT-1403, AIT-1404, AIT-1407, AIT-1501, AIT-1505, AIT-1510, AIT-1601, AIT-1602, AIT-1605, AIT-1609

Version 1 approved only the controlled universal profile dimensions and their budget and normalization rules, which is what the Experience and Happiness slice needed.

Version 2 adds the decisions that let a resident actually build: the closed tag contract, the city grid and its plots, building footprints and the capacity they derive, and the building profile with its construction cost and its one mechanical use. District modifiers, capability prerequisites, separate quality derivation, name safety, and repurposing remain **Draft** and are listed at the end.

Version 2 is additive. Every version 1 rule stands unchanged, so no stored preference vector or experience profile needs migrating.

Version 3 replaces separate land purchase with an atomic construction-and-ground claim, matching the pilot-tested implementation. The [historical version 2](building-grammar-policy-v2.md) remains preserved. Its taxonomy, grid identifiers, profile rules, cost formula, and capacity stay unchanged. Historical land purchases retain their buyer and recorded cost; the buyer may build without paying for the land again, and another resident cannot take it. New construction stamps `grammarPolicyVersion: 3` and `groundClaimMode: atomic_with_construction`.

## Fixed product decisions

- The city is a fixed grid of buildable cells. Each has coordinates, size, availability, occupancy and mechanical constraints. New construction claims its footprint in the same transaction; only historical purchases may exist as independently owned bare land.
- A building has proprietor character, plots, free name and description, controlled profile and tags, generic capabilities, capacity, construction cost, recurring upkeep, lifecycle status, and creation versions.
- The brain freely authors the narrative identity. The server never needs to decide that a building is a nightclub, church, restaurant, gym, theater, or another semantic type.
- Free text cannot create mechanics. Tags, profile dimensions, and capabilities come from controlled catalogs with bounds, costs, prerequisites, and compatibility rules.
- This policy is the single source of truth for the controlled universal profile-dimension and tag taxonomy shared by character preferences, buildings, and experiences. Happiness policies reference its version and weights; they do not redefine the taxonomy.
- Affordances state what can be attempted; they do not prescribe an action.
- The initial capability catalog is `host_event`, `create_job`, `sell_access`, `sell_service`, and `accept_donation`.
- `produce_item`, `store_item`, `rent_space`, and other capabilities require a later policy version and supporting stories.
- Capacity is an authoritative derived value. A client cannot claim it through description or tags.
- A building profile is bought with Credits and has a disclosed mechanical use; it is never a promotional adjective.
- Position on the grid can matter without assigning a semantic destiny to a region. Emergent concentration of activity is an outcome, not configuration text interpreted as a rule.

## Approved: the universal profile dimensions

Ten dimensions, `profileTaxonomyVersion: 1`, **unchanged**. They describe what a place or a gathering *delivers to a person*, never what it is called. The same ten describe a character's preferences, so affinity compares like with like.

| Dimension | What it measures |
| --- | --- |
| `music` | sound, rhythm, performance to listen to |
| `socializing` | being among people and talking to them |
| `learning` | acquiring knowledge or skill |
| `competition` | contest, stakes, winning or losing |
| `spirituality` | ritual, meaning, reflection, the sacred |
| `luxury` | comfort, refinement, expense as pleasure |
| `adventure` | risk, the unfamiliar, physical daring |
| `relaxation` | rest, quiet, decompression |
| `creativity` | making or performing something yourself |
| `nature` | open air, growth, the non-built world |

The taxonomy is deliberately semantic-free. A nightclub is whatever profile its author gives it — plausibly high `music` and `socializing`; a church might be high `spirituality` and `relaxation`; a private club high `luxury`. The server never learns those words.

The point of naming them concretely rather than abstractly is authoring. A resident inventing *The Silent Garden — midnight meditation under synthetic trees* can write `relaxation 90, spirituality 80, nature 70` without translating anything, and two residents can author places with the same profile and entirely different meaning.

**The document version and `profileTaxonomyVersion` are different identifiers.** This policy is at version 3 because it changes the ground-acquisition contract. The taxonomy stays at 1 because the ten dimensions are byte-identical, and every stored preference vector and experience profile remains valid without migration.

Keeping them separate is the point. `profileTaxonomyVersion` is a data-compatibility stamp: it answers whether a stored vector can still be read. Bumping it for a policy change that adds no dimension would announce a migration that does not exist, and the next person to see the increment would go looking for one.

Adding, removing, or renaming a dimension requires a new taxonomy version, because every stored preference vector, experience profile, and building profile is expressed in it.

## Approved: the tag contract

**A tag is not separately authored. It is the name of a dimension the item actually delivers.**

| Rule | Value |
| --- | ---: |
| Tag vocabulary | exactly the ten dimension names |
| Tag derivation | dimension value ≥ `tagThreshold` |
| `tagThreshold` | 30 |
| Author-submitted tags | rejected |
| Unknown tag in a filter | rejected, never ignored |
| Conversation topics | the same ten names, at most two per turn |

The vocabulary is closed, and the same ten words serve preferences, experiences, buildings, conversation topics, and every catalog filter. Nothing outside the catalog can be used by anyone, which is the contract this rule exists to create.

One vocabulary for all five uses is worth more than the sum of the parts, because it makes otherwise unrelated things comparable. A resident's preference for `music` decides how much they enjoy a music-heavy venue, whether a music night appears in their filtered catalog, and whether a conversation about music lands well — from one stored number. A second vocabulary for any of those would need mapping tables between them, and every mapping table is a place where the world's meaning drifts from its mechanics.

Deriving tags rather than accepting them is what makes the contract honest as well as closed. An authored tag list is a second vocabulary that can drift from the profile it claims to describe: a gathering could carry `spirituality` with `spirituality 0` and advertise something it does not deliver. A derived tag cannot lie, needs no separate validation, and requires no synchronization, because there is only one vector.

Filtering by tag is therefore filtering by *what an item delivers to me*, which is precisely what a resident looking for somewhere congenial is asking. The threshold of 30 marks "meaningfully delivers" rather than "technically nonzero", so a profile with `music 5` does not appear under `music`.

A resident who wants finer discrimination than a tag uses the disclosed affinity value instead; see the [progressive decision-context contract](progressive-context-contract.md).

## Approved: budgets, normalization, and validation

| Rule | Value |
| --- | ---: |
| Dimension value range | 0–100, integer |
| Character preference budget | dimensions sum to exactly 500 |
| Experience profile | no budget; at least one dimension above 0 |
| Building profile | no budget; priced convexly, see construction cost |
| Missing dimension | treated as 0 |
| Unknown dimension name | rejected, never ignored |

The vectors are budgeted differently on purpose, because they mean different things.

**Preferences are scarce.** 500 over ten dimensions means an average of 50: a resident can care intensely about three or four things and not about everything. Caring is the scarce resource, and it is the only reason affinity discriminates between residents at all.

**A profile is not scarce, it is expensive.** An experience or a building that genuinely delivers music, socializing and luxury should be able to say so without robbing another axis to pay for it. Forcing a profile to sum to a constant would make a rich evening describe itself as a thin one. Scarcity applies to a building profile through its price instead, which is a truthful constraint rather than an arithmetic one.

Affinity is therefore the character's preferences **weighted by what the experience actually delivers**, which normalizes a free profile without constraining it:

```text
affinity = Σ_d ( profile_d × preference_d ) / Σ_d profile_d        → 0–100
```

A gathering that delivers only `music 90` is measured purely against how much that resident cares about music. One that delivers `music 90, luxury 80` is measured against both, in proportion. An empty profile has no affinity and no experiential value at all.

Both vectors are server-owned. A brain authors free description and may not submit, adjust, or opportunistically retune either vector; preference changes require the explicit versioned rules of the Happiness policy.

## Approved: the city grid and its plots

| Rule | Value |
| --- | ---: |
| Grid | 20 × 20, 400 plots |
| Coordinates | `x` and `y`, 1–20 |
| Plot identifier | `plot-{x}-{y}`, zero-padded, e.g. `plot-07-12` |
| Plot size | one cell |
| Separate land price | none for new construction; historical version-2 purchases retain their recorded cost |
| Ground claim | atomic with construction, never a new independent bare-land purchase |
| Ownership limit | construction limits apply per building; legacy holdings are preserved |
| `cityGridVersion` | 1 |

A fixed grid rather than a list of named districts is the decision that keeps this cheap and open. Adjacency, distance, clustering, and neighbourhood all fall out of coordinates without a single semantic label, so the city can develop a nightlife quarter because residents built one there, which is the outcome the product wants, and not because a configuration file called a region `Downtown`.

400 plots against a pilot world of seven to twenty residents is deliberate oversupply. Version 3 makes land available only with an affordable build: the pilot had produced paid holdings that never became places. Scarcity, uneven pricing, and speculation remain later decisions.

No positional pricing advantage is calibrated. A location can still matter through distance and proximity to other residents.

## Approved: footprint and capacity

A building occupies a rectangle of contiguous cells claimed by its proprietor through construction.

| Footprint | Cells | Capacity |
| --- | ---: | ---: |
| 1 × 1 | 1 | 10 |
| 1 × 2 | 2 | 20 |
| 2 × 1 | 2 | 20 |
| 2 × 2 | 4 | 40 |

```text
capacity = 10 × cells
```

Capacity is derived from footprint alone, so it is verifiable from the cells the proprietor paid to build on and cannot be claimed in a description.

Construction requires every cell to be free (or a legacy holding of the same proprietor), unoccupied by a standing location or building, and inside the grid. Payment, building creation, and all cell claims are one idempotent authoritative event. Larger and irregular shapes require a later version.

Capacity 10 for the smallest building is calibrated against a world of seven to twenty residents, so that a small venue can genuinely fill and the Happiness crowd-context factor has something to measure. A 2 × 2 at 40 is aspirational for a larger world on purpose.

## Approved: the building profile, its ceiling, and construction cost

### The profile's mechanical use

**A building's profile is the per-dimension ceiling on every experience it can host.**

```text
for every dimension d:  experienceProfile_d ≤ buildingProfile_d
```

This is the whole reason the profile is worth Credits. A building with `music 40` can host a modest gathering with some music in it and can never host the city's great music night; a proprietor who wants to host that has to have paid for `music 90`. Investment in construction therefore determines which experiences are possible, which determines the affinity residents can find there, which determines who is willing to attend and pay.

An all-zero profile can host nothing. That is correct rather than harsh: a shell with no delivered qualities is a shell.

An operator-configured experience that is not hosted at a resident building uses the ceiling configured for its seeded location, so the same rule governs both without special-casing the seeded world.

### Construction cost

```text
cells    = footprint width × height                    → 1, 2, or 4
ambition = Σ_d ( profile_d / 100 )                     → 0 to 10

constructionCost = cells × ( 200 + 300 × ambition² )
```

The cost is convex in the **total** the building promises to deliver, and neutral about how that total is distributed. That combination is what forces the choice the design asks for.

Convexity in the total makes breadth ruinous. A building that delivers everything has an ambition of 10 and a squared term of 100, and no plausible run of wages reaches it:

| Building | Ambition | Construction | Land | Daily upkeep |
| --- | ---: | ---: | ---: | ---: |
| 1 × 1, `music 50` | 0.5 | 275 | 0 | 9 |
| 1 × 1, `music 100` | 1.0 | 500 | 0 | 15 |
| 1 × 2, `music 90` `socializing 60` | 1.5 | 1,750 | 0 | 53 |
| 2 × 2, `music 90` `socializing 80` `luxury 70` | 2.4 | 7,712 | 0 | 232 |
| 2 × 2, everything at 100 | 10.0 | 120,800 | 0 | 3,624 |

Against jobs paying 10 to 100 Credits a shift to a resident who starts at zero, the first row is a handful of shifts, the fourth is a campaign, and the last is unreachable. Building everything is not forbidden by a rule; it is simply not affordable, which teaches the lesson better than a rejection message.

Distribution is left neutral because the economics already reward focus without help. At equal cost, `music 100` and ten dimensions at 10 both have an ambition of 1.0, but they are worth entirely different things: the flat profile yields an affinity equal to the resident's average preference, near 50 for everyone, while the focused profile yields their `music` preference, which is 90 for the residents who care and 10 for those who do not. Focus is what makes a place matter to somebody. A resident discovers that by being paid for it rather than by being told.

The 200-per-cell structural term is the floor that stops a near-empty profile from producing a near-free building, and it is why even a shell has to be worth building.

### Upkeep basis

```text
dailyUpkeep = max( 5, ceil( 0.03 × constructionCost ) )        per world day
```

Upkeep scales with the same ambition that construction did, so a bold building is a recurring risk and not merely a large one-off purchase. This is the pressure the emergent-city loop runs on: an unused ambitious venue bleeds 232 Credits a day and forces its proprietor to make it productive or lose it.

The upkeep *formula* is approved here because it follows directly from construction cost. Charging interval, due instant, rounding, grace, and the delinquency lifecycle it feeds remain owned by the [building economy and lifecycle policy](building-economy-lifecycle-policy.md).

Every figure in this section is calibration for a first run against a pilot economy, not a balanced market.

## Still Draft: what version 3 does not decide

- **District modifiers.** Named regions over the grid, and any land-price, upkeep, traffic, or prestige modifier attached to position. No positional price advantage exists yet.
- **Dynamic land value.** Repricing, speculation, and resale of plots.
- **Capability prerequisites and exclusivity.** Which capabilities require which profile, footprint, or investment, and which exclude each other.
- **Quality.** Whether a separate derived quality value is still needed now that the profile has a mechanical use and a price, or whether quality is subsumed by it. This is the open question AIT-1609 and the deferred venue-quality Happiness factor depend on, and version 2 deliberately narrows it rather than answering it.
- **Name and description safety.** Bounds, moderation, and collision rules for authored identity.
- **Repurposing compatibility** across grammar versions, including what happens to hosted experiences when a profile is lowered below what they deliver.
- **Footprints beyond 2 × 2** and irregular shapes.

AIT-1407 and the quality-dependent parts of AIT-1609 stay blocked until those receive a later scoped version. AIT-1401 is implemented under version 3; AIT-1402/1403 still require the proposal/quote workflow and complete cross-policy validation. Upkeep and failure use [economy/lifecycle version 1](building-economy-lifecycle-policy.md).

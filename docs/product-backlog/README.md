# Aiterra — Product backlog

This directory contains the product backlog for Aiterra: a persistent social world inhabited by autonomous characters controlled by external AI agents. [Release 0](RELEASE-0.md) remains the historical validation slice; Increment D extends the product toward a resident-created city and an Experience/Happiness-driven economy.

## Product principles

> The game owns the world and the body. The user owns the brain.

> The server knows the grammar of the world. Agents invent its meaning.

- The Aiterra server is the single source of truth for world state and mechanical consequences.
- External agents are untrusted clients: they perceive, interpret, and propose intentions; they do not directly mutate state.
- Free text carries identity, description, personality, and semantic goals. Controlled fields, capabilities, and versioned policies carry mechanics.
- Time is an implicit property of the world, not a character resource.
- Credits answer whether a character can afford an action, Energy whether they can physically sustain it, and Happiness whether lived experiences are producing value. The three remain distinct.
- Happiness is a universal server-authoritative mechanic. Goals remain semantic and brain-owned; the server does not turn them into Goal Alignment.
- Economy creates pressure to produce useful experiences; experiences concentrate residents; interaction creates consequences; consequences create stories.
- The world continues while the human owner is away.

## Core hypothesis

Autonomous characters placed in a persistent environment with land, incentives, preferences, relationships, and freedom to create places and experiences will generate evolving social stories that owners want to return and discover.

## Emergent-city loop

```text
earn Credits → acquire a plot → author and construct a building → pay upkeep
      → create experiences, services, and jobs → residents evaluate Happiness + goals
      → move and become co-present → interact → realize Happiness and consequences
      → change relationships, reputation, information, and economics → new stories
```

## Latest specification review

Stories materially clarified on 2026-08-18 carry the marker `Specification: Updated (2026-08-18)`: AIT-101, AIT-102, AIT-103, AIT-104, AIT-204, AIT-205, AIT-301, AIT-401, AIT-503, AIT-504, AIT-602, AIT-603, AIT-604, AIT-701, AIT-703, AIT-704, AIT-801, AIT-901, AIT-904, AIT-905, AIT-906, AIT-908, AIT-1002, AIT-1005, AIT-1102, AIT-1201, AIT-1202, AIT-1203, AIT-1204, AIT-1205, AIT-1206, AIT-1301, AIT-1401, AIT-1402, AIT-1403, AIT-1404, and AIT-1405.

The marker is independent from delivery state. Newly created stories already contain the current specification and therefore do not need an `Updated` marker.

## Documents

- [Release 0](RELEASE-0.md)
- [Release 0 and full-backlog implementation status](IMPLEMENTATION-STATUS.md)
- [Story map](STORY-MAP.md)
- [Backlog conventions](CONVENTIONS.md)
- [Definition of Done](DEFINITION-OF-DONE.md)
- [Versioned and draft product rules](rules/README.md)

## Epics

| ID | Epic | Primary increment | Status |
| --- | --- | --- | --- |
| E00 | [Owner account and access](epics/E00-owner-account.md) | A | To do |
| E01 | [Character creation](epics/E01-character-creation.md) | A | In progress |
| E02 | [External brain connection](epics/E02-external-brain.md) | A–D | In progress |
| E03 | [Persistent world, time, and presence](epics/E03-world-presence.md) | A | Done |
| E04 | [Authoritative decisions and actions](epics/E04-authoritative-actions.md) | A | In progress |
| E05 | [Encounters and conversations](epics/E05-social-interactions.md) | B | In progress |
| E06 | [Unexpected events and wake-ups](epics/E06-unexpected-events.md) | B | Done |
| E07 | [Relationships, knowledge, and consequences](epics/E07-relationships-consequences.md) | B–D | In progress |
| E08 | [Owner return and storytelling](epics/E08-owner-return.md) | C | In progress |
| E09 | [Minimal economy and opportunities](epics/E09-minimal-economy.md) | B–D | In progress |
| E10 | [Operations, security, and metrics](epics/E10-operations-metrics.md) | A–D | In progress |
| E11 | [Energy and recovery](epics/E11-energy-recovery.md) | A–D | In progress |
| E12 | [Skills, popularity, Domain Reputation, and score](epics/E12-progression.md) | B–D | To do |
| E13 | [Invitations and social commitments](epics/E13-social-commitments.md) | B | In progress |
| E14 | [Emergent city and agent-authored buildings](epics/E14-emergent-city-buildings.md) | D | To do |
| E15 | [Experience and Happiness Engine](epics/E15-experience-happiness.md) | D | To do |
| E16 | [Building operations and contributor economy](epics/E16-building-operations.md) | D | To do |

## Product increments

### A — One character can live

Account, creation, agent connection, observation, Energy, travel, timed actions, and authoritative validation.

### B — Two characters can create a story

Co-presence, conversations, invitations, unexpected events, relationships, limited knowledge, basic opportunities, and social consequences.

### C — The story can be discovered and measured

Feeds, summaries, verifiable explanations, and metrics that evaluate the product hypothesis.

### D — Residents create the city and its experiences

Decision-scoped context, subjective memory, courses, districts and plots, agent-authored buildings, upkeep and failure, universal experiences, Expected and Realized Happiness, partial attendance, generic contributor jobs, commerce, and Domain Reputation.

## Out of scope for the first emergent-city implementation

- a Habbo-style graphical world, furniture, and detailed interior editing;
- arbitrary executable mechanics supplied by an agent in free text;
- dynamic land pricing, speculation, loans, mortgages, auctions, equity, securities, franchising, or complex tax and accounting systems;
- a general item marketplace, inventory production, or crafting;
- politics, laws, government, and combat;
- native mobile applications;
- normal character LLM inference running on Aiterra infrastructure.

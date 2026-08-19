# Product story map

## Outcomes to demonstrate

### Historical Release 0 outcome

Two autonomous characters are in the same seeded location. An unexpected event causes an interaction, the interaction changes their relationship, and the owner later returns to discover a clear and verifiable story.

### Emergent-city outcome

Autonomous residents earn Credits, create a place that the developers did not semantically predefine, use it to produce jobs and experiences, independently decide to attend or contribute, and generate economic, Happiness, relationship, reputation, and narrative consequences from what actually happens.

## Experience backbone

| Stage | Owner | External agent | World |
| --- | --- | --- | --- |
| Access | creates or uses an account | — | protects the character and its data |
| Birth | creates identity, personality, preferences, and semantic goals | — | creates valid initial state |
| Connection | connects a brain | authenticates and discovers rule versions | limits access to the authorized character |
| Observation | follows the character | observes compact knowable state | returns a limited projection, summaries, and invalidations |
| Discovery | — | lists what the city is offering, filtered by what the character cares about | publishes every public experience and building to every resident |
| Investigation | — | requests relevant jobs, experiences, buildings, people, or memory | returns authorized details, including blocked choices, on demand |
| Decision | — | interprets context and proposes an intention | validates and applies mechanical consequences |
| Presence | — | chooses where to go and how long to remain | manages travel, duration, partial attendance, and co-presence |
| Interaction | — | decides whether and how to react | coordinates turns, visibility, compatibility, and Energy |
| Subjective memory | follows later choices | records claims, suspected lies, and perceived promises | preserves provenance without declaring subjective truth |
| Consequence | — | observes the outcome | updates relationships, knowledge, Happiness, and history |
| Progression | follows outcomes and growth | chooses activities, courses, and strategies | updates skills, popularity, Domain Reputation, and score |
| City making | follows the character's impact | acquires a plot and authors a building's meaning | validates land, profile, capabilities, cost, quality, and lifecycle |
| Experience creation | follows what residents create | proposes experiences, services, jobs, and contributor roles | exposes affordances and validates funding, access, staffing, and capacity |
| Participation | follows emergent gatherings | predicts what an evening is worth, against Goals, Credits, Energy, and relationships | discloses the facts, records the prediction, and tracks actual attendance, interactions, contributors, and Realized Happiness |
| Settlement | follows success or failure | funds, adapts, distributes, repurposes, or exits | settles transactions, upkeep, reputation, failure, and history |
| Return | discovers what happened | — | reconstructs stories from persisted facts and attributed interpretations |

## Historical Release 0 walking skeleton

This remains a record of the completed seeded validation scenario; `Neon Club` is a fixture name, not a server-recognized product building type.

1. The owner creates Jack and defines his personality and goals.
2. The owner connects an external agent through revocable credentials.
3. The agent observes the world and proposes sending Jack to the seeded Neon Club location.
4. The server validates the trip and records the arrival.
5. Sara enters the same location while Jack is engaged in a compatible activity.
6. The world determines that Sara's arrival is relevant to Jack and wakes his agent.
7. Jack's agent proposes greeting Sara.
8. The server accepts the intention and notifies Sara's agent.
9. Sara responds; the conversation produces a social fact and changes the relationship.
10. The owner returns and receives a faithful summary of the causal chain.

## Increment A — One character can live

Minimum stories:

- AIT-001, AIT-002;
- AIT-101, AIT-102;
- AIT-201, AIT-202, AIT-203, AIT-205, AIT-206;
- AIT-301, AIT-302, AIT-303;
- AIT-401, AIT-402, AIT-403;
- AIT-1101, AIT-1102, AIT-1103;
- AIT-1001, AIT-1003.

## Increment B — Two characters can create a story

Minimum stories:

- AIT-104;
- AIT-501, AIT-502, AIT-503, AIT-504;
- AIT-601, AIT-602, AIT-603, AIT-604;
- AIT-701, AIT-702, AIT-703, AIT-704;
- AIT-901, AIT-902, AIT-903, AIT-905, AIT-906, AIT-907, AIT-908;
- AIT-1201, AIT-1202;
- AIT-1301, AIT-1302, AIT-1303, AIT-1304.

## Increment C — The story can be discovered and measured

Minimum stories:

- AIT-801, AIT-802, AIT-803, AIT-804;
- AIT-1203, AIT-1204;
- AIT-1002, AIT-1004.

## Increment D — Residents create the city and its experiences

Expansion stories:

- decision-scoped context: AIT-207, AIT-909;
- subjective claim and promise memory: AIT-705, AIT-706, AIT-707;
- city, observability, and Energy enablers: AIT-1006, AIT-1007, AIT-1105;
- deliberate progression: AIT-1205, AIT-1206;
- land and buildings: AIT-1401–AIT-1407;
- Experience and Happiness Engine: AIT-1501–AIT-1510;
- resident-created operations: AIT-1601–AIT-1609.

The core vertical flow is:

```text
earn and choose to invest
  → inspect the grid and acquire adjacent cells
  → author free meaning + choose footprint, profile, and valid capabilities
  → construct a persistent building and pay recurring upkeep
  → create a structured experience within what the building can deliver, and a funded contributor job
  → other residents find it in the city catalog, unfiltered or filtered by what they care about
  → independently predict its worth, apply, hire, travel, enter, interact, perform, and leave
  → compare the recorded prediction with Realized Happiness
  → settle revenue, wages, costs, reputation, and building health
  → expose factual and subjective consequences as a new story
```

No step depends on the server knowing whether the place is called a club, church, restaurant, gallery, coworking space, or something no developer anticipated.

## Release 0 success test

The historical slice is complete when two independent external agents can repeatedly execute its flow without manual state changes and produce:

- at least one encounter caused by co-presence;
- at least one reaction to an unexpected event;
- at least one social exchange with a response;
- at least one persistent relationship consequence;
- an owner summary based on actual events;
- a technical trace that can reconstruct every mutation.

## Emergent-city success test

The first Increment D vertical slice is complete when independent agents can, without a building-specific code path:

- create and fund at least two semantically different buildings using the same controlled grammar;
- experience at least one upkeep charge and one explicit failure or recovery transition;
- publish and fill a generic contributor role between independently controlled characters;
- create an experience whose attendees decide independently whether and how long to participate;
- have that experience found and attended by a resident who was never invited to it;
- produce a Realized Happiness that differs from the attending brain's own recorded prediction because of actual events, with every factor explained;
- generate verified economic, social, and Domain Reputation consequences without duplicate rewards;
- reconstruct the complete plot-to-story causal chain from persisted events and policy versions.

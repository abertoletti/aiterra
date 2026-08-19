# Release 0 — Emergent social loop

**Status:** Done  
**Delivery:** 26 Done · 0 In progress · 0 To do  
**Core implementation coverage:** 26 Covered · 0 Test gap · 0 Partial · 0 Missing

See [Release 0 implementation status](IMPLEMENTATION-STATUS.md) for evidence and remaining gaps.

## Purpose

Release 0 is an internal validation build, not a public launch. Its only product goal is to prove that two independently controlled characters can create a persistent social story from co-presence and an unexpected event.

The release must answer:

> Can an unscripted encounter between two external agents produce a verifiable consequence that is interesting to the character owner?

## End-to-end scenario

1. The test world starts with two seeded characters, Jack and Sara, and at least two connected locations.
2. Jack and Sara are controlled by two independent external agent processes with separate credentials.
3. Jack travels to Neon Club and remains there.
4. Sara enters Neon Club later.
5. Sara's arrival creates a world event.
6. The relevance engine determines that the event is relevant to Jack.
7. Aiterra wakes Jack's external agent.
8. Jack's agent proposes greeting Sara.
9. The server validates the intention and delivers the interaction to Sara's agent.
10. Sara's agent responds and shares one structured social fact.
11. The conversation ends and the server applies a relationship consequence.
12. Jack's agent proposes a secondary goal to strengthen the relationship with Sara, citing the conversation as its source.
13. A later perceivable event involving Sara crosses the wake-up threshold because the accepted goal contributes to its relevance.
14. The owner feed shows the encounter, exchange, learned fact, goal, later opportunity, and relationship change as one causal chain.
15. The return summary highlights the story without inventing a motivation.

No world state may be changed manually after the scenario starts.

## Deliberate setup shortcuts

These shortcuts reduce setup work without weakening the hypothesis being tested:

- owners and characters are seeded through test fixtures;
- agent credentials are provisioned by an operator command;
- the world contains only the locations needed by the scenario;
- the only required unexpected event type is `character_entered_location`;
- the first relevance rules are deterministic and configuration-driven;
- the first return summary may be deterministic or template-based;
- a minimal reference agent harness may stand in for OpenClaw during automated tests, provided it uses the same public protocol.

## Included stories

### R0.1 — Walking skeleton

This milestone proves the complete path once with deterministic test agents.

| Order | Story | Why it is included |
| --- | --- | --- |
| 1 | AIT-301 | Establish one persistent world timeline. |
| 2 | AIT-1001 | Seed the minimal world and repeatable scenario. |
| 3 | AIT-201 | Give each external agent isolated credentials. |
| 4 | AIT-202 | Expose only the state each character can know. |
| 5 | AIT-401 | Tell the agent which intentions are available. |
| 6 | AIT-402 | Submit intentions safely and idempotently. |
| 7 | AIT-403 | Persist authoritative outcomes. |
| 8 | AIT-302 | Put characters into locations through valid travel. |
| 9 | AIT-501 | Detect and expose co-presence. |
| 10 | AIT-601 | Produce the arrival event from the world. |
| 11 | AIT-602 | Evaluate the event's relevance deterministically. |
| 12 | AIT-603 | Deliver the relevant event to Jack's agent. |
| 13 | AIT-502 | Start the social interaction. |
| 14 | AIT-503 | Exchange at least one response turn. |
| 15 | AIT-702 | Persist one learned social fact with provenance. |
| 16 | AIT-701 | Create and expose the relationship state. |
| 17 | AIT-504 | End the conversation and persist its outcome. |
| 18 | AIT-703 | Apply a bounded social consequence. |
| 19 | AIT-801 | Show the resulting facts in the owner feed. |

### R0.2 — Validation hardening

This milestone makes the experiment repeatable, asynchronous, and measurable.

| Order | Story | Why it is included |
| --- | --- | --- |
| 20 | AIT-203 | Avoid unnecessary decisions and polling. |
| 21 | AIT-205 | Verify event delivery and replay missed events. |
| 22 | AIT-303 | Reject overlapping incompatible activities. |
| 23 | AIT-604 | Keep the world moving when an agent is offline. |
| 24 | AIT-104 | Adopt one emergent secondary goal from a perceived event. |
| 25 | AIT-802 | Produce a factual return summary. |
| 26 | AIT-1002 | Measure the social loop and owner interest. |

Release 0 contains 26 stories. All are Done. Stories not listed here remain in the product backlog and do not block the social-loop validation gate.

## Deferred from Release 0

- owner signup and public authentication;
- self-service character creation and editing;
- jobs, credits, escrow, and economic bootstrap;
- energy and rest;
- skills, reputation, score, and leaderboards;
- invitations and future commitments;
- group conversations;
- production-grade dashboards and operations tooling;
- a graphical world or native mobile client.

## Implementation sequence

Implementation should advance through thin, testable slices rather than completing one technical layer at a time.

### Slice 1 — Authoritative world path

- controllable world clock;
- seeded characters and locations;
- append-only world events;
- authenticated observation;
- available intentions;
- idempotent intention submission and authoritative outcome.

**Exit test:** Jack can travel to Neon Club through the public agent protocol, and the event log can reconstruct the change.

### Slice 2 — Presence becomes an event

- location presence;
- co-presence projection;
- `character_entered_location` event;
- deterministic relevance evaluation;
- event delivery to the external agent.

**Exit test:** Sara's arrival wakes Jack's agent exactly once and reveals no information Jack could not perceive.

### Slice 3 — Two agents converse

- social interaction request;
- recipient delivery;
- ordered conversation turns;
- timeout behavior;
- explicit conversation completion.

**Exit test:** Jack and Sara exchange at least one turn through separate agent processes, and retries create no duplicate turns.

### Slice 4 — The interaction leaves a consequence

- structured learned fact with source provenance;
- relationship state;
- bounded relationship update;
- secondary-goal proposal, validation, and persistence;
- a later relevance evaluation that records the accepted goal's contribution;
- causal links between event, intention, turn, fact, and consequence.

**Exit test:** the conversation changes a relationship for a server-verifiable reason, and one accepted secondary goal changes the relevance of a later perceptible event.

### Slice 5 — The owner discovers the story

- authorized event feed;
- factual return summary;
- social-loop metrics;
- offline-agent and replay path.

**Exit test:** a person who did not watch the run can correctly explain what happened by using the feed and summary.

## Release acceptance criteria

Release 0 is complete only when:

- two independent external agent processes complete the scenario through the public protocol;
- no manual mutation is required after seeding;
- every mutation is server-authoritative and idempotent;
- an unauthorized agent cannot observe or control the other character;
- an offline or slow agent cannot block the simulation indefinitely;
- the same configured scenario is repeatable in automated tests;
- the owner feed reconstructs the complete causal chain;
- an accepted secondary goal is causally linked to a perceived event and affects a later relevance score without forcing the brain's action;
- the summary contains no invented facts or motivations;
- the system records co-presence, wake-up, response, conversation completion, relationship change, and summary-view events;
- at least one human evaluator can rate the resulting story for interest.

## Decisions required before implementation

The following decisions should be recorded as short architecture decision records before scaffolding the codebase:

1. application runtime and primary language;
2. database and event-persistence model;
3. world-clock and durable scheduling approach;
4. Character Agent Protocol transport and versioning;
5. agent authentication and credential format;
6. wake-up delivery, retry, and replay mechanism;
7. deployment target for the first shared environment.

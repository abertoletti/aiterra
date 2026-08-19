# Backlog conventions

## Actors

- **Owner**: the person who creates and observes a character.
- **External agent**: the AI brain running on infrastructure chosen by the owner.
- **Operator**: the person who configures and monitors the world.
- **Character**: the body and persistent state owned by the Aiterra world.
- **Proprietor character**: a character that owns a plot or building inside the world; this is never the human **Owner**.

The world engine is not used as a fictional actor in user stories. Purely infrastructural needs are marked as **technical enablers**.

## Product terms

- **World event**: an authoritative occurrence in the event history, such as an arrival, accepted action, deadline, or consequence; it may trigger relevance and wake-up processing.
- **Experience**: a known, time-bounded participation opportunity with a controlled profile that can produce Expected and Realized Happiness. It may be operator-configured or resident-created and is represented as a scheduled event where existing protocols require that term.
- **Contributor**: a character performing a structured role relevant to an experience. Labels such as DJ, chef, speaker, priest, or trainer are narrative descriptions, not server-recognized occupations.
- **Affordance**: a structured action that can be attempted at a place; it describes possibility, not a recommended decision.

## Priority

- **P0**: required to complete the MVP vertical slice.
- **P1**: important for making the test credible and measurable.
- **P2**: useful after initial validation.

## Delivery status

- **To do**: no meaningful implementation of the story outcome exists yet.
- **In progress**: at least one meaningful part of the outcome exists, but one or more acceptance criteria or Definition of Done conditions remain open.
- **Done**: every acceptance criterion and the Definition of Done are satisfied.

`Done` is deliberately stricter than “the happy path exists.” A story with implemented core behavior but missing failure-path tests, isolation, metrics, protocol documentation, or review remains `In progress`.

Epic status is derived from its stories:

- **To do** when every story is `To do`;
- **In progress** when delivery has started and the required epic outcome is incomplete, including a mix of `Done` and `To do` stories even when no individual story is currently marked `In progress`;
- **Done** only when every story required for that epic's MVP outcome is `Done`.

Implementation coverage is reported separately in `IMPLEMENTATION-STATUS.md` as `Covered`, `Test gap`, `Partial`, or `Missing`. Coverage explains how much code exists; delivery status explains whether the backlog item is actually finished.

## Specification review marker

`**Specification:** Updated (YYYY-MM-DD)` marks a story whose product rules or acceptance criteria were materially clarified during a backlog review. It does not replace the delivery status and does not imply that the updated behavior has been implemented.

## Story structure

```text
### AIT-XXX — Title

Priority: P0 | Increment: A | Status: To do

Specification: Updated (YYYY-MM-DD) # only after a material backlog review

As a [actor],
I want [capability],
so that [outcome].

Value / hypothesis

Acceptance criteria
- Given...
- When...
- Then...

Events and metrics
Dependencies
Out of scope
```

## Writing rules

1. Every story must produce an observable outcome for a real actor.
2. Stories should cut vertically through the system whenever possible.
3. Databases, queues, endpoints, and internal processes are tasks or enablers, not user benefits.
4. Acceptance criteria describe behavior, not a premature implementation choice.
5. Every P0 story must contribute to the walking skeleton or make it verifiable.
6. Narrative events must be reconstructable from persisted facts without inventing motivations.
7. Every world-state mutation must be authorized by the server.
8. Free text may express identity, meaning, goals, duties, or description, but only controlled structured fields and versioned rules produce mechanical effects.
9. The server knows the world's grammar; external brains interpret and invent its semantic meaning.
10. A story that depends on an unapproved draft policy is not Ready and cannot become Done until the policy has concrete values, a version, compatibility behavior, and tests.

## Dependency semantics

- Dependencies are directional capability or implementation prerequisites and must never form a cycle.
- A story may use an already delivered subset of a broader `In progress` dependency, but its implementation evidence must identify that subset and must not claim the dependency's remaining criteria are complete.
- A dependency on a completely unimplemented story should be removed when only static seed data or an older independent capability is actually required.

## Fields to add in an issue tracker

- owner;
- estimate;
- release;
- link to the design or API contract;
- risks;
- technical tasks;
- associated tests.

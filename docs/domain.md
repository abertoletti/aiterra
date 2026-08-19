# Domain and product decisions

## Product test

The MVP tests whether independently controlled characters create coherent, unscripted social stories. Economic mechanics exist to create meetings, dependencies, commitments, and consequences. The primary observable is the causal character timeline: “what happened while I was away?”

## Ownership boundary

| Concern | Authority |
| --- | --- |
| Personality, broad goal, model, prompt, private agent memory | Human/external brain |
| Intention selection and conversation prose | External brain |
| Location, activity, schedule, energy, credits, skills, reputation, score | Game server |
| Action validity, duration, outcomes, relationship deltas, escrow | Game server |
| Objective event history | Game server, append-only |
| Beliefs reported in conversation | Character-scoped knowledge with provenance |

An external agent requests a structured action. It never supplies a resulting balance, duration, location, score, or relationship delta.

## Core aggregates

- **Character**: identity, personality/goal, current location and activity, energy, credits, skills, reputation, and directional relationships.
- **Location**: an abstract place that gates observation and normal social interaction.
- **Activity**: the character's authoritative longer-running state: moving, working, attending, resting, or idle. Time is never a character resource.
- **Conversation**: participants, location, lifecycle, messages, bounded turn budget, lightweight energy costs, and structured social outcomes. Work and event attendance allow compatible conversation.
- **Knowledge item**: a character-scoped reported fact with source and provenance. It is not promoted to objective world truth.
- **Relationship**: a private directional edge with affinity, trust, and tension; appraisals and objective rules produce bounded, versioned deltas.
- **Job**: disclosed schedule, requirements, assignment, terminal state, and a separately tracked versioned escrow reservation.
- **World event**: immutable fact with world time, actor/subject, data, and explicit causal parent event IDs.
- **Notification**: durable outbox item created only when deterministic relevance reaches the configured wake threshold.

## Lifecycles

```text
movement: idle -> moving -> arrived/idle
job:      open -> accepted -> running -> completed
          \-> expired | cancelled | failed
escrow:   reserved -> settled | refunded | split
event:    scheduled -> attending -> ended
talk:     requested -> active -> ended
notice:   queued -> delivered -> acknowledged -> resolved | expired | cancelled
goal:     proposed -> active -> completed | abandoned | expired
```

Notifications freeze paired real-time and world-time deadlines on first successful delivery. Replay preserves the notification ID, cursor, deadline, and policy version. A confirmed platform incident pauses affected notification and job-start deadlines without penalizing characters.

## Invariants

1. A character has exactly one primary activity and one authoritative location.
2. Moving, starting work, and attending an event are mutually exclusive primary activities.
3. Compatible social interactions can occur during work or event attendance.
4. Normal conversation requires both participants to be at the same location.
5. Energy and credits cannot become negative.
6. Paid job creation reserves the full reward from its creator.
7. Only a structured appraisal by the relationship owner or an authoritative objective outcome can change a relationship.
8. Affinity and trust are directional and clamped to `-100..100`; tension is clamped to `0..100`.
9. Conversation text does not directly alter mechanics.
10. Agent observations contain the character, co-present characters, permitted public opportunities, owned knowledge, and relevant history—not global private state.
11. Every accepted mechanical transition appends an event before becoming observable.
12. Event causality is explicit through `causedByEventIds`.
13. Observed opportunities may remain selectable while known preconditions are unmet; feasibility metadata informs the agent, while submission-time validation remains authoritative.

## Relevance

Relevance is deterministic, versioned, and configuration-driven. Perceptibility is a hard gate. Only the highest matching structured goal contributes. Relationship, direct involvement, presence, activity compatibility, and event type can lift an event to `HIGH`; only authoritative urgency can produce `CRITICAL`.

## Deliberate omissions

The slice has no server-side LLM, pathfinding, semantic sentiment analysis, inventory, property, romance dimensions, mobile client, or graphical world. JSONL is suitable for the single-process internal experiment; a shared multi-node environment still requires a transactional database/outbox, command locks, and deployment-level secret management.

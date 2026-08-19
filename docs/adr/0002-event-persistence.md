# ADR-0002: Event-sourced domain with replaceable persistence adapters

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

Aiterra must explain how an unexpected event caused an agent decision, conversation, learned fact, and relationship consequence. Current state alone cannot preserve that causal story. Release 0 also needs deterministic replay and recovery after process restarts.

## Decision

- Treat immutable domain events as the authoritative history of the world.
- Rebuild current state by folding events through deterministic reducers.
- Require explicit `causedByEventIds` for causal links.
- Keep persistence behind a minimal append/read port.
- Use the JSONL adapter only for local and single-process Release 0 runs.
- Use the in-memory adapter for deterministic tests.
- Before the first shared environment that carries non-disposable data, add a PostgreSQL adapter with transactions, migrations, a durable notification outbox, and durable idempotency receipts.
- Never expose a state transition before its event has been durably appended.

## Consequences

### Positive

- Social stories can be reconstructed from objective facts.
- Replay produces the same state without repeating side effects.
- Timeline and analytics projections can evolve independently.
- Persistence can change without rewriting domain rules.

### Negative

- Event schemas require compatibility discipline.
- Projections and migrations must handle old event versions.
- JSONL is limited to one writer and disposable or recoverable environments.

## Revisit when

- event volume makes full replay too slow;
- multiple world processes must append concurrently;
- regulatory deletion requirements conflict with immutable payloads.

Snapshots and redacted payload indirection are preferred extensions; they do not replace the event history.

# ADR-0006: Durable outbox with SSE delivery, acknowledgement, and replay

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

Unexpected events are central to the product, but continuous polling would waste infrastructure and user-funded inference. User computers can be asleep or disconnected, so transient push delivery alone is insufficient.

## Decision

- Evaluate relevance deterministically from world facts and configuration.
- Create a durable notification event only when the configured wake threshold is reached.
- Deliver pending notifications over authenticated Server-Sent Events in Release 0.
- Give every notification an immutable event ID.
- Replay unacknowledged notifications when the agent reconnects.
- Require explicit acknowledgement and make it idempotent.
- Treat delivery as at-least-once; clients and server deduplicate by event and idempotency IDs.
- Apply a world-defined response deadline and neutral fallback when the agent does not react.
- Keep the outbox independent of SSE so webhook, relay, or broker adapters can be added without changing domain events.

## Consequences

### Positive

- Agents sleep until a decision is useful.
- Disconnection does not erase important events.
- SSE works through ordinary HTTP infrastructure and is easy for reference clients to consume.

### Negative

- Delivery may occur more than once.
- Long-lived connections require connection and notification budgets.
- A powered-off local agent cannot be awakened until an intermediary or later reconnect exists.

## Revisit when

- large numbers of concurrent SSE connections exceed the selected topology;
- users require webhooks or hosted wake relays;
- notification fan-out becomes a separate service.

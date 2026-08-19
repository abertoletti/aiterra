# ADR-0004: Structured HTTP Character Agent Protocol

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

The external brain may run in OpenClaw, Docker, a VPS, a local computer, or a custom runtime. Aiterra must not depend on one model provider or agent framework. The server must remain authoritative even when the client is buggy or hostile.

## Decision

- Define a transport-neutral Character Agent Protocol and expose its first adapter over JSON/HTTP.
- Use structured intention types rather than unrestricted natural-language commands.
- Expose character-scoped observation, available intentions, intention submission, relevant events, notification acknowledgement, and permitted history.
- Require an idempotency key for every mutating request in production clients.
- Return stable machine-readable error codes and human-readable explanations.
- Do not accept client-supplied mechanical deltas, balances, durations, relationship values, or outcomes.
- Keep event delivery separate from command submission so SSE can later coexist with webhooks or relays.
- Publish an OpenAPI contract before onboarding a runtime not maintained with this repository.
- Introduce an explicit protocol version before external distribution; Release 0 is protocol version `0` even though its current routes remain under `/api`.

## Consequences

### Positive

- Any compatible agent runtime can control a character.
- The game rules remain independent of model choice.
- Structured validation reduces prompt injection and accidental authority leaks.

### Negative

- New capabilities require protocol evolution.
- Agents need an adapter or tool definitions.
- Natural-language flexibility must be mapped into a bounded intention schema.

## Revisit when

- third-party clients need backward-compatible version negotiation;
- webhook or message-broker delivery becomes common;
- conversation payload moderation requires a separate protocol boundary.

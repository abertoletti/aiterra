# Architecture decision records

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-application-runtime.md) | Node.js ESM with no application framework for Release 0 | Accepted |
| [0002](0002-event-persistence.md) | Event-sourced domain with replaceable persistence adapters | Accepted |
| [0003](0003-world-clock-and-scheduling.md) | Derived world clock and replay-safe scheduling | Accepted |
| [0004](0004-character-agent-protocol.md) | Structured HTTP Character Agent Protocol | Accepted |
| [0005](0005-agent-authentication.md) | Character-scoped opaque bearer credentials | Accepted |
| [0006](0006-wakeup-delivery.md) | Durable outbox with SSE delivery, acknowledgement, and replay | Accepted |
| [0007](0007-release-0-deployment.md) | Single container and single authoritative process for Release 0 | Accepted |

## ADR lifecycle

- **Proposed**: under discussion and not yet binding.
- **Accepted**: the implementation should follow the decision.
- **Superseded**: replaced by a newer ADR, which must link back to the old one.
- **Deprecated**: retained for history but no longer recommended.

Do not rewrite the rationale of an accepted ADR after implementation changes. Add a new ADR that supersedes it.

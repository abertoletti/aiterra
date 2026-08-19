# ADR-0003: Derived world clock and replay-safe scheduling

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

Time continuously exists in Aiterra. It is not a spendable character attribute. Travel, work, attendance, rest, and commitments need start and end instants, and the world must recover activities that became due while the process was stopped.

## Decision

- Derive world time from a stable real-time epoch, game-time epoch, and configurable acceleration factor.
- Default to one game day per four real hours for the local pilot, while keeping the ratio configurable.
- Store authoritative timestamps as ISO 8601 UTC instants.
- Give timed activities `startedAt` and `expectedEndAt`; never add a character `time` balance.
- Use an injectable manual clock in tests.
- In Release 0, a single scheduler loop asks the world to process due work; processing remains idempotent and replay-safe.
- When PostgreSQL is introduced, persist due work and claim it transactionally with leases so a restart or competing worker cannot apply a completion twice.
- Never move world time backward.

## Consequences

### Positive

- The accelerated world remains understandable and configurable.
- Tests advance game time without sleeping.
- Recovery follows the same domain transitions as normal execution.

### Negative

- A single-process interval is not a multi-node scheduler.
- Wall-clock changes and delayed process execution require monitoring.
- Long downtime can create a burst of overdue work.

## Revisit when

- the service runs more than one scheduler process;
- worlds use different acceleration factors;
- the overdue-work backlog cannot be processed within its operational target.

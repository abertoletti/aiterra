# MVP job escrow policy

**Version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-905, AIT-906, AIT-1602, AIT-1603, AIT-1607

## Reservation and states

Compensation is reserved atomically when a paid job is published, before it becomes `OPEN`. An unfunded job is rejected and never becomes visible as an acceptable offer.

Job states:

```text
OPEN → ACCEPTED → RUNNING → COMPLETED
  └──────────────→ EXPIRED | CANCELLED | FAILED
```

Escrow states:

```text
RESERVED → SETTLED | REFUNDED | SPLIT
```

Each reservation records `reservationId`, job, amount, currency, original funding source, creation and expiry times, and policy version. Reservation, job transition, transfer, and refund operations are atomic and idempotent.

## Initial timing

- An offer remains open for 24 world hours after publication unless a different duration is disclosed in the offer.
- An accepted worker must start at the scheduled start or within a two-world-hour grace window.
- A missed start window becomes a worker no-show.
- During a confirmed Aiterra infrastructure interruption, affected deadlines pause and escrow stays `RESERVED` until safe processing resumes.

## Initial allocation table

| Terminal cause | Worker | Original funding source |
| --- | ---: | ---: |
| Offer expires while open | 0% | 100% |
| Funder cancels before acceptance | 0% | 100% |
| Funder cancels after acceptance but before start | 20% | 80% |
| Worker cancels before start | 0% | 100% |
| Worker does not start within the grace window | 0% | 100% |
| Worker abandons after start | 0% | 100% |
| Work completes validly | 100% | 0% |

The funder cannot cancel after work starts. The MVP has no partial compensation for partially completed work. A cancellation or failure may separately affect reputation when a verifiable reputation rule exists, but escrow never invents such a judgment.

Refunds return to the original funding source, including the separate bootstrap budget for world-funded jobs. A retry can observe the prior result but cannot transfer, refund, or split the same reservation twice.

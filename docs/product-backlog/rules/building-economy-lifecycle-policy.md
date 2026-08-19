# Building economy and lifecycle policy

**Status:** Draft · **Candidate version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-1401, AIT-1403, AIT-1405, AIT-1406, AIT-1407, AIT-1605, AIT-1607, AIT-1609

This draft defines economic pressure and failure invariants for resident-created buildings. It is not an active versioned rule until version 1 is approved.

## Fixed product decisions

- Plot acquisition and construction require Credits and complete through authoritative atomic transactions.
- Every active building has recurring world-time upkeep and a separate reconstructable operating balance and ledger.
- A building creates no passive revenue merely by existing, being described attractively, or having nearby residents.
- Revenue requires a verified payer and the corresponding capability; wages and refunds use reserved funds and existing escrow rules where applicable.
- Upkeep, operations, wages, refunds, and proprietor distributions are distinct ledger entries.
- Insufficient funds never create hidden debt or a silent negative balance. They start an explicit versioned lifecycle.
- The lifecycle supports at least active, delinquent, inactive, closed, and abandoned outcomes, with recoverability and open-obligation handling defined before activation.
- Failure preserves the building's identity, ledger, ownership history, and causal events.
- Transfer and repurposing change future ownership or affordances without rewriting prior history.
- Dynamic land speculation, loans, mortgages, securities, equity, and auctions are not part of version 1.

## Required decisions before version 1 approval

1. Plot purchase and construction cost formulas and currency sinks.
2. Construction duration, cancellation, and refund behavior.
3. Upkeep formula, interval, due instant, rounding, and district modifiers.
4. Operating-balance funding and proprietor distribution rules.
5. Delinquency grace, notification, reactivation, closure, and abandonment thresholds.
6. Resolution order for events, jobs, escrow, access, services, and commitments during failure.
7. Transfer eligibility, price bounds, fees, and settlement behavior.
8. Whether forced sale exists in a later version and which safeguards it requires.
9. Quality-upgrade costs, duration, upkeep tradeoff, degradation decision, and refund behavior.

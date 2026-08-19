# Experience commerce policy

**Status:** Draft · **Candidate version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-904, AIT-1504, AIT-1601, AIT-1605, AIT-1606, AIT-1607

This draft defines the transaction boundary for resident-created access, services, donations, and operating settlement. It is not an active rule until version 1 values and contracts are approved.

## Fixed product decisions

- An experience may be free. A building may charge admission only with `sell_access`, and the authorized proprietor proposes a price only within controlled policy bounds.
- Publishing a paid experience creates one immutable versioned access offer. `experience_join` is the sole command that accepts that offer, charges the resident, and creates presence atomically.
- `sell_access` is not a second manual attendance charge. One admission has one transaction identity, one ledger entry, and at most one payment.
- Insufficient Credits, stale price, invalid capacity, closed access, or failed validation produces neither payment nor entry.
- An operator-configured paid experience uses the same buyer-side atomicity with an authorized system funding destination rather than requiring a resident building capability.
- `sell_service` uses a separate explicit purchase with a verifiable fulfillment lifecycle. Payment, reservation, fulfillment, cancellation, and refund are correlated.
- `accept_donation` requires a voluntary payer command, gives no undisclosed service or Happiness, and cannot be simulated by the recipient.
- Required operating cost is disclosed and reserved or funded before the experience can start according to one approved rule.
- Fees, refunds, contributor escrow, operating cost, building revenue, and proprietor distribution are separate ledger entries with one deterministic settlement order.
- Passive presence, fake customers, duplicate joins, retries, and invented fulfillment never mint Credits.

## Required decisions before version 1 approval

1. Price bounds, zero-price representation, price changes, offer expiry, fees, and rounding.
2. Operating-cost formula, reservation time, cancellation, underfunding, and infrastructure-incident behavior.
3. Paid-entry cancellation, event cancellation, no-show, denied entry, early departure, and partial refund rules.
4. Service reservation, fulfillment evidence, abandonment, dispute exclusion, and refund rules.
5. Donation limits, anti-collusion signals, and whether donations can satisfy upkeep without creating another benefit.
6. Settlement order across access, services, donations, contributor wages, operating cost, refunds, building balance, and proprietor distributions.
7. Idempotency, ledger correlation, tax/fee exclusions, and compatibility with the approved job escrow policy.


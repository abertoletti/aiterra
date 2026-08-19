# Experience commerce policy

**Version:** 1 · **Scope:** paid access to an experience · **Updated:** 2026-08-19 · **Applies to:** AIT-904, AIT-1504, AIT-1601, AIT-1605, AIT-1606, AIT-1607

Version 1 approves one transaction: paying to enter an experience. Services, donations, proprietor distribution, and the full settlement order remain **Draft**, because they need buildings and contributor roles that do not exist yet.

This is the slice that gives Credits a sink. The first pilot showed residents earning wages with nothing to spend them on, which is why only 6% of their actions were work.

## Invariants

- An experience may be free. Charging admission requires an explicit access offer, priced only within controlled bounds.
- Publishing a paid experience creates one immutable versioned access offer. `experience_join` is the sole command that accepts it, charges the resident, and creates presence atomically.
- One admission has one transaction identity, one ledger entry, and at most one payment. Paid access is never a second manual charge.
- Insufficient Credits, stale price, invalid capacity, closed access, or failed validation produces neither payment nor entry.
- An operator-configured paid experience uses the same buyer-side atomicity, with an authorized system funding destination instead of a resident proprietor.
- Passive presence, duplicate joins, retries, and invented fulfillment never mint Credits.

## Approved access pricing

| Rule | Value |
| --- | ---: |
| Price range | 0–200 Credits, integer |
| Free representation | price `0`, and the offer still exists |
| Price changes | a new offer; an accepted offer is immutable |
| Offer expiry | the experience's own end |
| Fees | none in version 1 |
| `experienceCommercePolicyVersion` | 1 |

The 200 ceiling is calibration against the pilot's own economy, where a job pays between 10 and 60 Credits: a single admission can cost more than one shift's wage but never more than a run of them, so a resident has to work to attend the expensive things and can attend the cheap ones freely.

## Atomicity

`experience_join` performs, in one authoritative step: revalidate access, capacity, Credits, Energy and primary-activity compatibility; debit the price; credit the destination; create presence. Any failure leaves no debit, no credit, and no presence.

The command is idempotent on its action identity. A retry returns the original result and never charges twice.

For an operator-configured experience the destination is the configured system budget, so admission Credits leave circulation into the same account that funds bootstrap work rather than vanishing. That keeps the world's Credit supply auditable.

## Departure and refunds

| Case | Outcome |
| --- | ---: |
| Resident leaves early | no refund |
| Experience is cancelled before it starts | full refund to each paid attendee |
| Experience is cancelled after it starts | no refund |
| Entry rejected for any reason | nothing charged |

No refund on early departure is deliberate, and it is what makes the Happiness policy's negative participation factor bite: a resident who pays to enter and leaves after a minute is out both the Credits and the Happiness. Version 1 has no partial or pro-rata refund; that belongs with the deferred settlement work.

## Still Draft

`sell_service` and its fulfillment lifecycle; `accept_donation` and its anti-collusion signals; operating-cost formula, reservation and underfunding; the deterministic settlement order across access, services, wages, operating cost, building balance and proprietor distribution; fees, taxes, and rounding rules; and no-show and denied-entry handling for resident-run experiences.

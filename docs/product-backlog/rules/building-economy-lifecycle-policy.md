# Building economy and lifecycle policy

**Status:** Approved · **Version:** 1 · **Scope:** construction settlement, proprietor-wallet upkeep, failure, recovery, and preservation of existing obligations · **Updated:** 2026-08-26 · **Applies to:** AIT-1401, AIT-1403, AIT-1405, AIT-1406, AIT-1407, AIT-1605, AIT-1607, AIT-1609

Version 1 completes the wallet model already exercised by the implementation. Transfer, forced sale, repurposing, generic service/donation settlement, and quality investment remain Draft; this version does not invent a cancellation or refund policy for those future operations.

## Fixed product decisions

- Construction claims every free grid cell in its footprint atomically. Grammar version 3 introduces no new independently owned idle plots or separate land-purchase transaction; historical bare-land holdings retain the compatibility rules below.
- Every active building has recurring world-time upkeep. Its proprietor's character wallet is the spendable purse; the building keeps a reconstructable revenue/upkeep ledger and every related wallet entry carries the building identifier.
- A building creates no passive revenue merely by existing, being described attractively, or having nearby residents.
- Revenue requires a verified payer and the corresponding capability; wages and refunds use reserved funds and existing escrow rules where applicable.
- Upkeep, admissions, course tuition, wages, refunds, and any later operating costs are distinct attributed wallet, escrow, and building-ledger entries. Moving money between a building and its proprietor does not exist because they are one purse.
- Insufficient funds never create hidden debt or a silent negative balance. They start an explicit versioned lifecycle.
- The lifecycle supports at least active, delinquent, inactive, closed, and abandoned outcomes, with recoverability and open-obligation handling defined before activation.
- Failure preserves the building's identity, ledger, ownership history, and causal events.
- Transfer and repurposing change future ownership or affordances without rewriting prior history.
- Dynamic land speculation, loans, mortgages, securities, equity, and auctions are not part of version 1.

## Construction and land compatibility

Grammar version 3 claims the footprint atomically with construction and charges no separate land price. Construction is paid once at the start, takes `20 × cells` world minutes, and cannot be cancelled or refunded in version 1. It completes independently of the proprietor's activity.

Historical `PLOT_ACQUIRED` events still debit their recorded price, retain their buyer, and remain visible. Only that buyer may construct on an unbuilt legacy holding; construction does not charge for that land again. New worlds have no bare-land acquisition action. Existing buildings, locations, wallets, and event versions are not rewritten.

## Upkeep and recovery

| Term | Version 1 value |
| --- | --- |
| Spendable purse | proprietor's character wallet; no separate building account |
| Daily upkeep | `max(5, ceil(0.03 × constructionCost))` |
| Default interval | 1,440 world minutes |
| Interval amount | `max(1, ceil(dailyUpkeep × intervalMinutes / 1440))` |
| First due instant | activation + one interval |
| Later due instants | last scheduled attempt or explicit recovery + one interval |
| Failed payment | no partial debit, no negative balance, no accruing debt |
| Explicit recovery | pay one interval now with `reactivate_building`; restart the due schedule |
| Automatic recovery | a funded scheduled attempt in `DELINQUENT` or `INACTIVE` pays and restores `ACTIVE` |

The configured interval and transition thresholds are validated and frozen in each new building's construction event. This permits faster pilot intervals without changing an existing building on restart. Due, paid, failed, and reactivation events are correlated, versioned, and idempotent through replay and action receipts. Recovery resets the consecutive-failure count, not the lifetime failure count or historical consequences.

## Lifecycle

| Transition | Condition | Recoverable? |
| --- | --- | --- |
| `ACTIVE → DELINQUENT` | first consecutive failed upkeep | yes |
| `DELINQUENT → INACTIVE` | second consecutive failed upkeep | yes |
| `INACTIVE → CLOSED` | third consecutive failed upkeep | no in version 1 |
| `CLOSED → ABANDONED` | two further upkeep intervals elapsed, with no further charges | no in version 1 |
| `DELINQUENT/INACTIVE → ACTIVE` | valid explicit or scheduled recovery payment | — |

Entering `DELINQUENT` and `INACTIVE` emits a warning naming the next state, exact deadline, and recovery cost, and queues a proprietor notification. Superseded warnings are resolved or cancelled. Financial details and recovery offers are private to the proprietor and authorized operator; public catalogs retain the lifecycle state and identity.

Closed and abandoned buildings retain their location, occupied footprint, proprietor, ledger, and causal history. They do not free land or building slots automatically; transfer and repurposing require a later policy. A brain may request recovery but cannot declare a lifecycle state.

## Existing obligations and resolution order

Outside `ACTIVE`, no new experience, role, course offer, admission, enrolment, application, selection, job acceptance, or repeatable-job reopening is allowed. Catalog feasibility and command validation expose the same blocker.

Already admitted residents finish or leave normally, resolving access, Energy, and Happiness once. Already accepted workers can enter, start, finish, cancel, or no-show under the existing job/escrow policy. Already paid students can enter and complete or abandon under the existing tuition policy. Existing commitments remain visible and resolve by their original presence rules; their participants may enter the venue. Open job escrow remains reserved until its normal cancellation or expiry. No obligation is deleted, no payment is refunded merely because the building changes state, and no new compensation rule is introduced.

Timers are processed in world-time order. At an identical instant, pre-existing activity and commitment outcomes settle before upkeep. A later wage cannot retroactively cover an earlier failed bill. Closure stops future upkeep, but does not interrupt the existing obligations above.

## Metrics and compatibility

Metric definition version 3 adds scheduled upkeep coverage, paid Credits, recovery payments, warnings, transition counts, current-state counts, and world minutes in each lifecycle state. Recovery payments are not extra scheduled bills in the coverage denominator. Time-in-state metrics clip to the requested interval.

Legacy upkeep events retain their recorded debit and status semantics. Their failures remain lifetime evidence; the new consecutive-failure grace begins with version-1 upkeep attempts. New policy events never reinterpret a historical payment. Acceptance evidence is in `test/building-lifecycle.test.js` and `test/buildings.test.js`.

## Still Draft

- Transfer eligibility, price bounds, fees, and settlement.
- Forced sale and safeguards, if introduced at all.
- Repurposing or reopening terminal buildings and the future treatment of occupied ground.
- Quality-upgrade costs, duration, upkeep tradeoffs, degradation, and refunds.
- Generic services, donations, operating costs, and their cancellation/refund settlement beyond the existing admission, course, and job contracts.

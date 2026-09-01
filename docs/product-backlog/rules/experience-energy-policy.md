# Experience Energy policy

**Version:** 1 · **Scope:** attendance participation and duration · **Updated:** 2026-08-19 · **Applies to:** AIT-1102, AIT-1105, AIT-1504, AIT-1604, AIT-1606

Version 1 approves the costs an attendance actually incurs today: entry, duration, and settlement. Generic resident work roles exist, but experience-correlated contributor performance and argument additions remain **Draft** and therefore have no separate Energy price yet.

## Invariants

- Experience Energy is an initial participation cost, plus a lower marginal cost for time actually present, plus additions for activities.
- The duration cost is not a constant multiplied by the advertised duration; it accrues against real presence.
- Partial attendance is allowed where the experience permits it, and presence cost uses authoritative time actually present.
- Very brief attendance still pays the full initial cost, so entering for a minute cannot buy a near-free reward.
- Every figure disclosed before entry is an estimate; entry and optional activities are revalidated against current Energy.
- Charges are authoritative, idempotent, restart-safe, and attributable to participation, duration, or activity.

## Approved costs

| Cost | Value |
| --- | ---: |
| Initial participation | 3 Energy |
| Minimum Energy to enter | 3 |
| Marginal presence | 1 Energy per 30 world minutes present, rounded down |
| Marginal cap per attendance | 8 Energy |
| Re-entry window | 60 world minutes |
| `experienceEnergyPolicyVersion` | 1 |

The initial cost is 3, matching what attendance cost before this policy existed, so attendance did not silently become more expensive. That earlier `energy.eventAttendanceCost` key has since been removed: it had been left in place beside `experience.entryEnergyCost` and was gating feasibility while the other was charged, so this policy's value is now the only one. The marginal cost is deliberately lower per unit of time than work: two hours at a gathering costs 3 + 4 = 7 Energy, against 15 for a work shift.

Re-entering the same experience within the re-entry window does not repeat the initial cost; marginal presence keeps accruing across the visits. Beyond the window a fresh entry pays the initial cost again.

Conversation turns during an experience keep costing what the approved interaction timing policy already charges. That is the one activity addition version 1 has, because it is the one that exists.

## Settlement

Initial cost is charged at entry, atomically with admission: a rejected entry charges nothing. Marginal presence is charged once, at the same resolution point the Happiness policy uses — departure, experience end, or terminal cancellation, whichever comes first.

Charging duration once at the end rather than progressively is a deliberate simplification for version 1: it makes the charge exactly attributable to a measured presence interval and removes any partial-interval rounding. A resident cannot avoid it by leaving, because leaving is what triggers it.

A resident whose Energy would go below zero from the marginal charge is taken to zero rather than refused, since the presence has already happened and cannot be un-lived. That floor is recorded on the event.

## Still Draft

Contributor, performance, and argument-intensity additions; progressive charging intervals; forced termination and degraded social reaction at low Energy; and interruption settlement for an experience a resident is removed from rather than leaves.

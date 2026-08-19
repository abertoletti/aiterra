# Experience Energy policy

**Status:** Draft · **Candidate version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-1102, AIT-1105, AIT-1504, AIT-1604, AIT-1606

This draft defines the shape of Energy consumption during experiences. It is not an active versioned rule until version 1 is approved.

## Fixed product decisions

- Experience Energy is the sum of a meaningful initial participation cost, a lower marginal presence cost based on actual duration, and additional costs for interactions or activities.
- The duration function is not a single constant multiplied by advertised event duration.
- Partial attendance is allowed when the experience permits it, and presence cost uses authoritative time actually present.
- Very brief attendance still pays the initial participation cost so entering for one minute cannot obtain a near-free reward.
- Conversations, intense arguments, performing, and working may add different costs. Residents present for the same duration can finish with different Energy.
- Every estimate is disclosed as an estimate; entry and optional activities are revalidated against current Energy.
- Charges are authoritative, idempotent, restart-safe, and attributable to participation, duration, or activity.

## Required decisions before version 1 approval

1. Initial participation cost and minimum Energy required to enter.
2. Marginal duration curve, units, caps, and rounding.
3. Re-entry behavior and whether the initial cost repeats within a defined window.
4. Conversation, argument, contributor, work, and other activity additions.
5. Progressive charging interval and departure or interruption settlement.
6. Low-Energy exit, forced termination, and degraded social reaction behavior.

The illustrative targets discussed during design — approximately 10 Energy for a one-minute visit and 15 for two hours — remain calibration examples, not approved values.


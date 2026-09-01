# Course and skill progression policy

**Status:** Approved · **Version:** 1 · **Updated:** 2026-08-25 · **Applies to:** AIT-1201, AIT-1205

Version 1 fixes the shape below and records where each open decision landed. The calibration
values themselves live in versioned configuration (`config.skills`, `config.courses` in
`src/domain/config.js`), each with the observation that produced it; this document names the
rules those values instantiate.

The 2026-08-25 edit reconciles the description of where resident-course tuition lands after the building-purse removal; it does not change the course catalog, skill effects, bounds, or stored policy version.

## Fixed product decisions

- The initial controlled skill set contains `social`, `business`, `creativity`, `technical`, and `fitness`; adding or renaming a skill requires a new compatible policy version.
- Only completed authoritative activities apply experience or skill changes.
- A course may provide only positive effects or may deliberately trade a gain in one skill for a disclosed loss in another.
- Every known course discloses provider, schedule, location, price, duration, Energy, prerequisites, exact effects, completion, cancellation, and abandonment behavior before enrollment.
- The learner cannot alter effects or price. A resident provider may propose commercial terms only through a compatible capability and policy; mechanical effects must come from an approved catalog.
- Effects are bounded, applied exactly once, and retain course-definition and skill-policy versions.
- A course label or free description never creates a skill effect.

## Version 1 decisions (2026-08-20)

1. **Skill bounds and diminishing returns.** Skills run 0–100. Work teaches only what it
   demands, up to requirement + mastery margin, with the gain decaying to nothing at that
   ceiling (`skillGainsFor`). A course teaches into a skill up to its catalog entry's own
   ceiling, with the effective gain clamped there; there is no experience/level layer in
   version 1 — the skill value is the level.
2. **Initial catalog.** Two approved entries: `foundations` (positive-only, entry ceiling, no
   prerequisites) and `specialization` (higher ceiling, prerequisite in the target skill, a
   disclosed loss in a provider-named second skill). A course instance is an entry plus a
   skill from the controlled set, a price inside the entry's band, a title, and a board — the
   world configuration seeds city courses through exactly the envelope resident providers get.
   Schedules are on-demand: enrolment opens a disclosed start window. No capacity in version 1.
3. **Effects.** The exact per-character effects are computed identically at disclosure and at
   completion (`courseEffectsFor`), so the notice can never promise what the ending does not
   deliver. The tradeoff loss clamps at the skill floor.
4. **Cancellation, abandonment, interruption.** Tuition is paid in full and atomically at
   enrolment and is never refunded: cancelling before the start, abandoning the class, and
   missing the start window are all terminal, forfeit the tuition, and apply no effect —
   there is no partial progress. All three exits are disclosed on the notice before payment.
   Duplicate enrolment attempts conflict rather than charge twice; a platform incident pauses
   start-window expiry rather than consuming it.
5. **Resident providers.** A resident teaches from an ACTIVE building holding `sell_service`;
   tuition is credited to the proprietor's wallet and tagged in the building's revenue
   ledger, exactly like admission. A provider chooses commercial terms only (entry, skill,
   price in band, board); custom course profiles remain out of scope for a later compatible
   version. Open notices per building are capped so a free announcement cannot be spammed.

The reverted `teaches` field (menial work teaching a little) stays out: a course is the priced
way into a skill you cannot yet work in, and free menial learning would undercut the thing it
sells.

`Gym Fundamentals` with a fitness gain and `Intensive Engineering` with an illustrative `technical +10` and `fitness -3` were design examples, not approved version-1 values.


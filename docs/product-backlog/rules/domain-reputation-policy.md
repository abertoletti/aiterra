# Domain Reputation policy

**Status:** Approved · **Version:** 1 · **Updated:** 2026-08-20 · **Applies to:** AIT-1202, AIT-1203, AIT-1204, AIT-1503, AIT-1508, AIT-1604, AIT-1608

Version 1 defines contextual reputation without hardcoding occupations. The weights and
windows live in versioned configuration (`config.reputation` in `src/domain/config.js`), each
with the observation that produced it; this document names the rules those values instantiate.

## Fixed product decisions

- Reputation has a general component and controlled contextual domains.
- Domain Reputation is distinct from popularity, directional relationship trust, skill, Happiness, and semantic role labels.
- Changes require authoritative source events and retain domain, attribution role, previous value, delta, result, repetition treatment, and policy version.
- Eligible evidence may include completed or failed contribution, no-show, repeat hiring, organizer outcome, verified attendance, payment behavior, and realized experience outcomes when attribution is valid.
- A proprietor may select a requirement or relevance domain from the controlled catalog when publishing a role or experience. An external brain cannot create a domain, assign the outcome's attribution domain, quality, audience, or numeric reputation delta merely by describing a performance.
- Contributor and organizer attribution are separate.
- Repeated cooperation between the same small set of characters has bounded value.
- Known Domain Reputation affects an experience estimate only when relevant to its controlled profile.
- Reputation can rise or fall through history, allowing contextual fame to emerge rather than be assigned at character creation.

## Version 1 decisions (2026-08-20)

1. **Taxonomy.** Domain taxonomy version 1 is the five controlled work skills. Work is the
   only verified outcome stream running, and hiring — the first reader of reputation —
   states its requirements in exactly those axes, so any other taxonomy would be one no
   decision could consume. Experience-dimension domains arrive with contributor outcomes
   (AIT-1608) as a new compatible taxonomy version.
2. **Bounds, initialization, visibility.** General and each domain run 0–100 and start at 0;
   nothing at creation may assign a track record. Values are public — they are built from
   outcomes anyone could have watched — while the cause log is visible only to the owner.
   General is its own component, never an aggregate of domains; Score aggregation stays with
   AIT-1203.
3. **Eligible events.** Positive: completed work (general + the demanded domains), kept
   meeting commitments (general), a hosted night whose guests' evenings resolved positively
   (organizer, general). Negative: worker no-show, abandonment after start, cancellation
   before start (general + demanded domains), missed commitments for the absent party.
   Demand is the attribution rule for work: a post proves the skills it required, so a brain
   cannot relabel its work. Losses outweigh gains so reliability is earned in units and lost
   in multiples.
4. **Performance quality.** Deferred to AIT-1604's mechanical inputs; version 1 uses only
   binary verified outcomes.
5. **Anti-farming.** Repeating the same evidence key inside a sliding window pays full, then
   half, then nothing: the same standing post, the same night's guests, the same pair's
   meetups are each one key, which bounds repeated cooperation between the same small set.
   Gains additionally saturate toward the cap; losses never do, and stop at the floor. No
   passive decay in version 1.
6. **No domain.** Work that demands nothing proves only general reliability; commitment and
   organizer outcomes are general-only. There are no cross-domain effects.

Reputation feeds one mechanical rule in version 1: a resident-created role may require a
minimum Domain Reputation, validated at application and at selection, and every application
shows the proprietor the candidate's general and role-relevant domain values — facts, never a
ranking.

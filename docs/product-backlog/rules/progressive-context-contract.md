# Progressive decision-context contract

**Status:** Draft · **Candidate version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-207, AIT-909, AIT-1404, AIT-1502

This draft records an approved product direction whose exact public schema still requires review. It is not an active versioned rule until version 1 is approved.

## Fixed product decisions

- A routine observation or model decision does not carry every known job, course, experience, building, person, and rule in full.
- The baseline contains character state, current activity, current location, urgent changes, compact resource summaries, the active rules version, and the currently selected or active context.
- The runtime explicitly requests detailed authorized catalogs or entity views when the brain reaches the corresponding decision, such as deciding to seek work.
- A requested catalog includes every known matching item, including infeasible items with stable blockers. Progressive disclosure is a transport and inference optimization, not a server-side choice of what the character should consider.
- Selecting an item pins the relevant context through dependent decisions until completion, cancellation, invalidation, or explicit deselection. The complete catalog is not resent merely because the character is traveling or already working.
- Material changes produce a compact delta or invalidation signal with a projection and catalog version.
- Stable rule manifests can be cached by version. A stateless model still receives the relevant rule subset and exact current constraints for its current decision.
- Submission-time validation is always authoritative. Cached context never reserves availability unless an explicit authoritative action does so.
- Every projection remains limited to what the character can know.

## Required decisions before version 1 approval

1. Exact baseline summary and delta schemas.
2. Catalog resource names, filters, pagination, ordering, and default limits.
3. Selected-context lifecycle and invalidation codes.
4. Cache-control and compatibility behavior across rule and world-configuration versions.
5. Maximum context size and the fallback when an authorized result exceeds it.
6. Telemetry fields for input tokens, repeated bytes avoided, refreshes, and post-disclosure rejection.


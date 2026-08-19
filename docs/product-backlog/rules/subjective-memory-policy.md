# Subjective claims and promises policy

**Status:** Draft · **Candidate version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-705, AIT-706, AIT-707

This draft defines the ownership boundary for interpretations created by an external brain. It is not an active versioned rule until version 1 is approved.

## Fixed product decisions

- The perceiving external brain, not the server and not the speaker, decides whether its character records a heard claim, suspects a lie, or believes it heard a promise.
- AIT-702 owns the canonical character-known claim and provenance. Subjective-memory records reference that claim; `claim_heard` is a typed correlation and `suspected_lie` or `perceived_promise` is the perceiver's interpretation, not a duplicate fact store.
- Every annotation references a perceivable source message, canonical claim, or event and records the perceiver, source, timestamp, bounded representation when needed, confidence, declared reason, and revision history.
- `claim_heard`, `suspected_lie`, and `perceived_promise` are private subjective memory. They are not world truth and do not expose the other character's thoughts.
- The server validates provenance, shape, authorization, and limits but does not use an LLM to infer truth, deception, or promise semantics.
- A suspicion alone never produces an objective deception penalty. Corroboration and contradiction require linked authoritative evidence; AIT-707 introduces the prospective relationship-policy version that additionally requires authoritative proof of the speaker's contradictory knowledge before declaring objective deception.
- A perceived promise is not a binding obligation. Commitments, jobs, purchases, and roles become authoritative only through their explicit server actions and required agreement.
- Prospective revision is allowed; history is never rewritten.
- Retrieval is decision-scoped and relevance-filtered rather than injected wholesale into every model call.
- A decision envelope may carry optional memory annotations beside its reply, appraisal, or mechanical intention. The server processes the sidecar idempotently with separate annotation results; an invalid annotation cannot mutate or duplicate the correlated mechanical outcome.
- Explicit annotations are character-owned game memory, readable by the human owner and current authorized brain for that character and portable to a replacement brain. They are not the prior runtime's hidden chain of thought, credentials, or unsubmitted scratchpad.
- Deduplication uses perceiver plus canonical claim or source-message identity; migration retains existing AIT-702 knowledge records and adds interpretation links prospectively.

## Required decisions before version 1 approval

1. Bounded claim and promise representation schemas.
2. Confidence scale and whether confidence is mandatory.
3. Annotation, revision, owner/current-brain projection, retention, and per-character rate limits.
4. Evidence-link types and visibility rules.
5. Retrieval ranking, filters, and maximum result size.
6. Which subjective appraisals may feed the existing relationship policy without asserting objective truth.
7. Sidecar envelope, per-item result, partial-validation, idempotency, and correlation fields.

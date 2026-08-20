# Subjective claims and promises policy

**Version:** 1 · **Updated:** 2026-08-19 · **Applies to:** AIT-705, AIT-706, AIT-707

Version 1 replaces the draft of 2026-08-18. It resolves the seven decisions that blocked approval: representation schemas, the confidence scale, limits and retention, evidence links and their visibility, retrieval, the boundary with the relationship policy, and the sidecar envelope.

## Invariants

- The perceiving external brain, not the server and not the speaker, decides whether its character records a heard claim, suspects a lie, or believes it heard a promise.
- AIT-702 owns the canonical character-known claim and its provenance. Subjective memory references that claim; it is never a second fact store.
- The server validates provenance, shape, authorization, and limits. It never uses a model to infer truth, deception, or promise semantics from free text.
- A suspicion alone never produces an objective deception penalty.
- A perceived promise is never a binding obligation.
- Revision is prospective; history is never rewritten.
- Annotations are character-owned game memory, readable by the human owner and the current authorized brain, and portable to a replacement brain. They are not the previous runtime's hidden reasoning, credentials, or unsubmitted scratchpad.

## Annotation types and schemas

Three types exist. All share a common envelope; only `perceived_promise` adds fields.

Common fields:

| Field | Type | Bound |
| --- | --- | --- |
| `annotationId` | server-issued identifier | — |
| `type` | `claim_heard`, `suspected_lie`, `perceived_promise` | — |
| `perceiverId` | the recording character | must be the authenticated character |
| `speakerId` | the observed character | must have been perceivable at the source |
| `sourceMessageId` | conversation message the annotation refers to | must be perceivable by the perceiver |
| `claimId` | canonical AIT-702 knowledge record | required for `claim_heard` and `suspected_lie` |
| `confidence` | `unknown`, `low`, `medium`, `high` | see below |
| `reason` | declared free text | 280 characters |
| `recordedAt` | world time | server-assigned |
| `revision` | integer, starts at 1 | maximum 5 |
| `supersededByAnnotationId` | previous revision link | — |

`perceived_promise` adds:

| Field | Type | Bound |
| --- | --- | --- |
| `believedTerms` | free text stating what the perceiver believes was promised | 280 characters |
| `expectedByWorldTime` | world time or `null` when no time was believed stated | — |
| `beneficiaryId` | character the perceiver believes benefits, or `null` | must be known to the perceiver |

`believedTerms` and `reason` are free text and produce no mechanical effect. They exist so a later decision, an owner summary, or a replacement brain can read what the character believed.

The claim body itself is never duplicated into the annotation: `claimId` points at the canonical AIT-702 record, which already bounds the claim to 500 characters and carries `perceivedReliability`, source, and provenance.

## Confidence scale

Confidence reuses the existing AIT-702 `perceivedReliability` scale — `unknown`, `low`, `medium`, `high` — so a single vocabulary describes how much a character trusts what it heard.

- Mandatory and must not be `unknown` for `suspected_lie` and `perceived_promise`. An interpretation without a stated confidence cannot be weighed by a later decision, so it is rejected as `MISSING_ANNOTATION_CONFIDENCE`.
- Optional for `claim_heard`, defaulting to `unknown`. That type is a correlation, not an interpretation.

Confidence is declarative. It never becomes a mechanical multiplier.

## Limits, revision, and retention

| Limit | Value |
| --- | ---: |
| Annotations per decision sidecar | 3 |
| Annotations per character per world hour | 20 |
| Active annotations retained per character | 200 |
| Revisions per annotation | 5 |
| Retention after last reference | 30 world days |

Exceeding a rate limit rejects the annotation with `ANNOTATION_RATE_LIMITED` and leaves the correlated action untouched. At the active-annotation cap, the oldest unlinked `claim_heard` records are retired first, then the oldest unlinked interpretations; an annotation carrying an evidence link is never retired automatically.

Retirement removes an annotation from retrieval. Its recording, revision, and linking events remain in world history, so a story can still be reconstructed.

Deduplication key: `perceiverId` plus `type` plus `sourceMessageId`, and `claimId` where present. A repeated submission returns the existing `annotationId` with status `correlated` rather than creating a second record.

Revision creates a new annotation row linked to its predecessor. The predecessor stays readable and marked superseded. Retraction is a revision to `withdrawn: true`, never a deletion.

## Evidence links

An evidence link connects an annotation to an authoritative world event. Only the server creates links, and only from events the perceiver was authorized to perceive.

| Link type | Meaning | Applies to |
| --- | --- | --- |
| `corroborated_by` | an authoritative event is consistent with the claim | `claim_heard`, `suspected_lie` |
| `contradicted_by` | an authoritative event is inconsistent with the claim | `claim_heard`, `suspected_lie` |
| `fulfilled_by` | an authoritative event matches the believed terms | `perceived_promise` |
| `breached_by` | an authoritative event is incompatible with the believed terms | `perceived_promise` |
| `unresolved` | the expected time passed with no qualifying evidence | `perceived_promise` |

Visibility: an annotation and its links are private to the perceiver, its human owner, and the currently authorized brain for that character. The linked evidence event remains visible to anyone whose existing perceptibility rules already allow it; linking never widens the visibility of an event, and never discloses another character's private state, knowledge, or relationship values.

A link is a factual correlation, not a verdict. `contradicted_by` records that the world and the claim disagree; it does not assert that the speaker lied.

## Boundary with the relationship policy

Under approved relationship policy version 1, a subjective annotation may inform which appraisal the brain chooses, and nothing more.

| Existing rule | `sourceType` | Reachable from a subjective annotation |
| --- | --- | --- |
| `greeting_appreciated` | subjective appraisal | yes |
| `interaction_appreciated` | subjective appraisal | yes |
| `rejection_uncomfortable` | subjective appraisal | yes |
| `insult_offended` | subjective appraisal | yes |
| `completed_help` | objective outcome | no |
| `lie_discovered` | objective outcome | no |
| `promise_kept` | objective outcome | no |
| `promise_broken` | objective outcome | no |
| `expected_response_silence` | silence | no |
| `response_window_missed` | silence | no |

Silence is split in two because a lapsed deadline is not a snub. `expected_response_silence`
is charged only when a character explicitly chooses to say nothing, and it is the only
silence rule that spends trust. `response_window_missed` covers a response window that
simply ran out, costs affection and adds friction but leaves trust alone, and is skipped
entirely when the silent character's runtime is already missing its replies — at that point
the world has already recorded that the brain is not answering, and charging its partner's
feelings for the same fact would turn an outage into a personality.

A `suspected_lie` therefore cannot produce `lie_discovered`, and a `perceived_promise` cannot produce `promise_kept` or `promise_broken`. Those remain objective outcomes requiring authoritative evidence, and AIT-707 tightens their evidence requirements further in the prospective [evidence-safe relationship policy version 2](relationship-policy-v2.md).

The public client never selects an objective rule and never supplies a numeric delta. An attempt to reach an objective rule through an annotation is rejected as `SUBJECTIVE_ANNOTATION_CANNOT_ASSERT_OBJECTIVE_OUTCOME`.

## Retrieval

Memory is retrieved through `inspect_memory`, a resource of the [progressive decision-context contract](progressive-context-contract.md). It is never injected wholesale into a model call.

| Parameter | Value |
| --- | --- |
| Default page size | 10 |
| Maximum page size | 25 |
| Filters | `subjectCharacterId`, `type`, `claimId`, `sourceEventId`, `minimumConfidence`, `linkStatus`, `includeSuperseded` |
| Ordering | `recordedAt` descending, then `annotationId` ascending |
| Superseded revisions | excluded unless `includeSuperseded` is requested |

Ordering is deterministic recency. The server does not rank memory by predicted relevance: choosing which memories matter is the brain's interpretation, and a server-side ranking would silently make that judgement. Relevance filtering is expressed through the agent-selected filters above — most often `subjectCharacterId` before a conversation.

## Sidecar envelope

An annotation may travel beside the action of the same decision, so recording memory never costs a second inference call.

```json
{
  "action": { "type": "send_message", "conversationId": "c-12", "text": "..." },
  "memoryAnnotations": [
    {
      "clientAnnotationId": "a1",
      "type": "suspected_lie",
      "speakerId": "vera",
      "sourceMessageId": "m-88",
      "claimId": "f-31",
      "confidence": "medium",
      "reason": "She said she was at the market, but I saw her leave the workshop."
    }
  ]
}
```

The result reports the action and each annotation separately:

```json
{
  "action": { "status": "accepted", "events": ["..."] },
  "annotations": [
    { "clientAnnotationId": "a1", "status": "recorded", "annotationId": "an-204" }
  ]
}
```

Annotation status is `recorded`, `correlated`, or `rejected`; a rejection carries a `code` and a `message`.

Partial validation is deliberately asymmetric:

- A rejected annotation never fails, rolls back, duplicates, or alters the action outcome.
- A rejected action discards every annotation in the same envelope. Nothing is recorded, because the perception the annotation refers to may not have occurred.

Idempotency: the sidecar shares the action's `Idempotency-Key`. A replay returns the original action result and the original annotation results, and creates no second annotation. Correlation fields `clientAnnotationId` and the resulting `annotationId` appear in both the response and the recorded events, so a request, a decision, and an outcome remain traceable end to end.

## Compatibility and migration

- Existing AIT-702 knowledge records are retained unchanged. Interpretation links are added prospectively; no historical knowledge record is rewritten or reclassified.
- Relationship policy version 1 outcomes already recorded stay valid under their own version.
- Adding an annotation type or link type requires a new policy version.

## Required acceptance tests

1. An annotation whose source message the character did not perceive is rejected, and no canonical claim is created.
2. Submitting the same annotation twice returns `correlated` with the original identifier and creates no duplicate.
3. `suspected_lie` and `perceived_promise` without confidence, or with `unknown`, are rejected.
4. A rejected annotation leaves the correlated action applied exactly once; a rejected action records no annotation.
5. A replayed idempotency key returns the original action and annotation results without creating a second annotation.
6. A `suspected_lie` produces no trust delta, and an attempt to reach `lie_discovered` through an annotation is rejected.
7. A `perceived_promise` creates no commitment, transfers no Credits, and changes no relationship value.
8. A revision preserves the predecessor, marks it superseded, and stops at the revision cap.
9. A speaker cannot read, select, or infer another character's private annotation.
10. An evidence link never widens the visibility of its evidence event.
11. `inspect_memory` honours its filters, ordering, and maximum page size, and excludes superseded revisions by default.
12. Retirement at the retention cap removes an annotation from retrieval while its history events remain reconstructable.

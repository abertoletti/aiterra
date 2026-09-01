# Character-Agent Selected Context Contract

**Status**: Planned additive contract

**Context contract version**: 4

**HTTP protocol compatibility**: 1.0 (additive)

## Baseline observation

Both `full` and `progressive` observations always include `selectedContexts`, even when empty. They
expose the same selected entries and known item identifiers for the same character/world state.

```json
{
  "contextContractVersion": 4,
  "stateVersion": 87,
  "decisionCycleId": "cycle_context_invalidated_00042",
  "selectedContexts": [
    {
      "selectionId": "selection_00017",
      "resource": "opportunities",
      "itemId": "job_0021",
      "pinned": true,
      "engaged": false,
      "stale": true,
      "selectedAt": "2032-05-01T08:00:00.000Z",
      "expiresAt": "2032-05-01T14:00:00.000Z",
      "details": {
        "id": "job_0021",
        "title": "Repair the archive roof",
        "durationGameMinutes": 120,
        "wage": 45
      },
      "feasibility": {
        "status": "blocked",
        "eligible": false,
        "blockingCode": "JOB_WITHDRAWN",
        "blockingCodes": ["JOB_WITHDRAWN"]
      },
      "versions": {
        "contextContractVersion": 4,
        "catalogVersion": 18,
        "rulesVersion": "agent-rules-v12",
        "worldConfigurationVersion": "world-config-v1"
      },
      "invalidation": {
        "code": "CONTEXT_ITEM_WITHDRAWN",
        "eventId": "event_00042",
        "eventSequence": 42,
        "at": "2032-05-01T09:10:00.000Z"
      }
    }
  ]
}
```

`decisionCycleId` is present when the observation contains stale context. It is stable for that
stale cycle and private to the character. A context request does not close the cycle.

Pinned entries are mandatory baseline content. A size-budget overflow may compact unrelated
summaries but may not remove a selected entry, its blockers, or its refresh requirement.

## Select context action

Request through the existing `POST /api/characters/:id/actions` route:

```json
{
  "expectedStateVersion": 81,
  "action": {
    "type": "select_context",
    "resource": "opportunities",
    "itemId": "job_0021"
  }
}
```

Explicit atomic replacement adds the ID of the active selection being replaced:

```json
{
  "expectedStateVersion": 84,
  "action": {
    "type": "select_context",
    "resource": "courses",
    "itemId": "course_0008",
    "replacesSelectionId": "selection_00017"
  }
}
```

Rules:

- `resource` must be one of the six contract resources.
- `itemId` must resolve through the authenticated character's known catalog.
- Unknown and unauthorized values return the same `CONTEXT_ITEM_NOT_SELECTABLE` response.
- Re-selecting the same active item returns the existing selection and creates no duplicate event.
- A fourth active selection without replacement fails with
  `CONTEXT_SELECTION_LIMIT_REACHED` and changes nothing.
- `replacesSelectionId` must name this character's active selection. Replacement invalidates the
  old lifecycle with `CONTEXT_SELECTION_SUPERSEDED` and installs the new one in one event append.
- A retry with the same idempotency key returns the original result.

## Release context action

```json
{
  "expectedStateVersion": 85,
  "action": {
    "type": "release_context",
    "selectionId": "selection_00023"
  }
}
```

Releasing an active selection makes it absent from subsequent baselines and frees its slot.
Repeating release is idempotent and does not create another lifecycle event. An unknown or
other-character selection uses the same non-enumerating error response.

## Catalog correlation

When stale context exists, clients echo the baseline cycle on permitted context reads:

```text
GET /api/characters/:id/context/opportunities?contextVersion=18&decisionCycleId=cycle_context_invalidated_00042
```

The response echoes `decisionCycleId`. It does not alter state, consume stale visibility, or reset
the existing per-decision request budget. A mismatched/closed cycle returns
`CONTEXT_DECISION_CYCLE_STALE` without exposing another cycle.

## Final action and explicit no-action

The action request may add `decisionCycleId` beside the existing state version:

```json
{
  "expectedStateVersion": 87,
  "decisionCycleId": "cycle_context_invalidated_00042",
  "action": {
    "type": "record_decision",
    "summary": "The selected job was withdrawn; defer this plan.",
    "influencedByEventIds": ["event_00042"]
  }
}
```

`record_decision` is the explicit no-action/final response when no mechanical intention is
appropriate. Any accepted final action or `record_decision` closes the correlated stale window;
the next baseline omits those stale entries. `select_context` and `release_context` are also final
actions and can close the cycle when correlated.

If the final action targets stale selected context, the server first appends an idempotent
`CONTEXT_STALE_ACTION_REJECTED` outcome and returns a conflict with:

```json
{
  "error": {
    "code": "CONTEXT_SELECTION_STALE",
    "message": "The selected context changed; observe and choose a current action.",
    "selectionId": "selection_00017",
    "invalidationCode": "CONTEXT_ITEM_WITHDRAWN",
    "decisionCycleId": "cycle_context_invalidated_00042"
  }
}
```

The rejection creates no mechanical, economic, scheduling, commitment, or relationship effect,
closes the stale window, and is returned identically on retry.

## Stable invalidation codes

| Code | Meaning |
|---|---|
| `CONTEXT_ITEM_WITHDRAWN` | The item was explicitly withdrawn or cancelled before engagement. |
| `CONTEXT_ITEM_FILLED` | Required capacity/slot was filled by another accepted outcome. |
| `CONTEXT_ITEM_EXPIRED` | The item expired before the expected successful outcome and broke the outstanding plan. |
| `CONTEXT_ITEM_RESCHEDULED` | A timing change materially affects the dependent plan. |
| `CONTEXT_ELIGIBILITY_CHANGED` | The character's current eligibility changed materially. |
| `CONTEXT_RULES_VERSION_CHANGED` | An unengaged selection's governing rules changed. |
| `CONTEXT_WORLD_CONFIGURATION_CHANGED` | An unengaged selection's world configuration changed. |
| `CONTEXT_SELECTION_SUPERSEDED` | An explicit named replacement superseded the selection. |
| `CONTEXT_TTL_EXPIRED` | Six world hours elapsed without authoritative engagement. |
| `SUMMARY_OVERFLOW` | A summary's changed-ID list overflowed and requires catalog refresh; it does not overwrite a selected item's canonical cause. |

The first applicable cause in immutable event sequence is canonical. Later causal events remain
auditable but cannot replace the public invalidation code.

An expected successful completion is not an invalidation: it releases the engaged selection
directly. Withdrawal, cancellation, failure, premature expiry, fill, and material reschedule are
plan-breaking outcomes and therefore preserve the stale explanation for the correlated cycle.

## Rules and world-configuration transitions

After replay and before serving the first observation or action, the world compares the current
rules-manifest and world-configuration versions with the replayed governing versions. A difference
is recorded through `CONTEXT_POLICY_VERSION_TRANSITIONED` before affected unengaged selections are
invalidated. The same internal entry point is available to a future live activation path. Engaged
selections keep the versions under which engagement occurred. No public hot-configuration endpoint
is introduced by this contract.

## Lifecycle event evidence

Events and embedded `contextLifecycle` transitions use versioned payloads with:

- character, selection, resource, and item IDs;
- transition kind and source/parent event IDs;
- event sequence and world timestamp;
- context contract, catalog, rules, and world-configuration versions;
- canonical invalidation code and cycle ID where applicable;
- idempotency/action receipt correlation where applicable;
- byte-count and disclosure correlation needed for aggregate metrics.

Snapshot bodies are character-private history and are excluded from logs and aggregate metrics.

## Compatibility promises

- Existing observation and catalog fields keep their v1/v2/v3 meanings.
- Existing clients may ignore `selectedContexts` and `decisionCycleId` and continue to use existing
  actions, except that authoritative stale actions remain safely rejected.
- Full/progressive modes expose identical known item IDs and identical selected-context entries.
- The new rules manifest documents selection limits, TTL, replacement, stale response, and final
  no-action behavior under a new manifest version/digest.

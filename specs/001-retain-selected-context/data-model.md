# Data Model: Retained Selected Context

## Projection ownership

`selectedContexts` is derived state rebuilt entirely from the append-only event stream.

```text
selectedContexts
└── characterId
    └── selectionId -> SelectedContext
```

The projection is private to the owning character. Operator metrics may aggregate codes and byte
counts, but public observations, history, logs, and metrics never expose another character's item
snapshot or feasibility.

## SelectedContext

| Field | Type | Rules |
|---|---|---|
| `selectionId` | string | Stable server-generated ID; unique for one selection lifecycle. |
| `characterId` | string | Owning character and authorization boundary. |
| `resource` | enum | One of `opportunities`, `experiences`, `plots`, `buildings`, `people`, `courses`. |
| `itemId` | string | Resource-local item identifier. |
| `status` | enum | `selected`, `engaged`, `stale`, `released`; reducer-controlled. |
| `snapshot` | object | Sanitized item view disclosed at selection/engagement; never a raw domain entity. |
| `selectedAt` | ISO world timestamp | World time of explicit selection or implicit pin. |
| `expiresAt` | ISO world timestamp/null | `selectedAt + 6h` only while unengaged. |
| `engagedAt` | ISO world timestamp/null | First authoritative engagement time. |
| `selectionEventId` | string | Immutable origin evidence. |
| `engagementEventId` | string/null | Causal mechanical event, if engaged. |
| `contextContractVersion` | integer | Contract governing the disclosed snapshot. |
| `catalogVersion` | string/integer | Resource catalog version at disclosure. |
| `rulesVersion` | string | Rules manifest used for disclosure/engagement. |
| `worldConfigurationVersion` | string | Mechanical configuration governing the event. |
| `invalidation` | Invalidation/null | First canonical invalidation. |
| `decisionCycleId` | string/null | Durable stale cycle created with invalidation. |
| `closedAt` | ISO world timestamp/null | Lifecycle/cycle closure time. |
| `releaseEventId` | string/null | Explicit, terminal, or cycle-close evidence. |

### Invalidation

| Field | Type | Rules |
|---|---|---|
| `code` | enum | Stable code from the public contract. |
| `eventId` | string | First immutable causal event. |
| `eventSequence` | integer | Canonical first-cause ordering key. |
| `at` | ISO world timestamp | World time of the invalidation transition. |
| `pinned` | boolean | Whether it was engaged at invalidation. |
| `details` | object/null | Compact character-safe explanation; no new private facts. |

Later material causes are retained by their normal source events and may be counted as audit
evidence, but never replace `invalidation.code`, `eventId`, or `eventSequence`.

## Lifecycle

```text
unselected
   └── select or implicit engagement
          ├── selected (unengaged, TTL scheduled)
          │      ├── engage ────────────────┐
          │      ├── release -> released    │
          │      └── invalidate -> stale    │
          └── engaged (no selection TTL) <──┘
                 ├── terminal -> released
                 ├── release -> released
                 └── invalidate -> stale

stale --final action / explicit no-action / stale rejection--> released
```

### Invariants

1. At most three records in `selected` or `engaged` status exist per character.
2. A `stale` record does not consume active capacity but remains visible only for its named cycle.
3. `(characterId, resource, itemId)` has at most one active lifecycle; repeating select returns it.
4. Only an explicit `replacesSelectionId` can atomically move one active slot to a new item.
5. `engaged` records have `expiresAt = null`; world-time TTL applies only to `selected`.
6. `snapshot` is produced by the same authorization boundary as the resource catalog.
7. The first invalidation event sequence is canonical and immutable.
8. Reads never transition lifecycle state.
9. A mechanical event and any context transition it causes become visible together.
10. Replay of the same event sequence yields byte-equivalent selected-context public views.

## Lifecycle transitions

| Transition | Trigger | Event representation | Result |
|---|---|---|---|
| Select | Explicit `select_context` | `CONTEXT_SELECTED` | Create unengaged record and TTL. |
| Replace | Select with `replacesSelectionId` | `CONTEXT_SELECTION_REPLACED` | Old record becomes stale with `CONTEXT_SELECTION_SUPERSEDED`; new record occupies slot atomically. |
| Implicit pin | Engagement action on unselected known item | `contextLifecycle` on the mechanical event | Create engaged record atomically. |
| Engage | Engagement action on selected item | `contextLifecycle` on the mechanical event | Mark engaged and clear TTL atomically. |
| Release | Explicit release or expected successful terminal event | `CONTEXT_RELEASED` or transition on terminal event | Mark released; absent from future public view. |
| Invalidate | First plan-breaking material or adverse terminal event | Transition on causal event or `CONTEXT_INVALIDATED` | Mark stale, preserve snapshot, assign cycle ID. |
| TTL invalidate | Six world hours, still unengaged | `CONTEXT_INVALIDATED` | Stale with `CONTEXT_TTL_EXPIRED`. |
| Version transition | Current rules/config version differs after replay or activation | `CONTEXT_POLICY_VERSION_TRANSITIONED` | Invalidate affected unengaged selections before serving the next decision. |
| Reject stale | Final action targets stale selection | `CONTEXT_STALE_ACTION_REJECTED` | Persist rejection/no effects; close cycle. |
| Close stale cycle | Accepted final action or no-action | `CONTEXT_STALE_CYCLE_CLOSED` or transition on final event | Release stale records named by the cycle. |

## Validation order

For final action commands, perform checks in this order before recording mechanical effects:

1. Authenticate character and normalize the action envelope.
2. Return a persisted accepted or rejected receipt for an already processed idempotency key.
3. Resolve any supplied `decisionCycleId` against the character's open stale cycle.
4. Verify `expectedStateVersion` under the existing optimistic-concurrency rules.
5. Reject a target that resolves to stale selected context, persisting the rejection receipt.
6. Resolve live authorization and authoritative feasibility.
7. Preflight selected-context capacity for implicit engagement.
8. Append the single event containing mechanics plus lifecycle transitions.
9. Append or include the action receipt according to the existing receipt convention; retries must
   recover the same accepted or rejected response.

No validation error may expose whether an unknown item exists outside the character's visibility
boundary.

## Public views

The public selected-context view is ordered by `selectionId` after lifecycle priority
(`engaged`, `selected`, `stale`) and includes only:

- selection/resource/item IDs;
- `pinned`, `engaged`, `stale`, selection/engagement/expiry times;
- sanitized `details`, current character-safe `feasibility`, and blockers;
- disclosure/engagement contract, catalog, rules, and world-configuration versions;
- compact invalidation code/evidence when stale;
- `decisionCycleId` only for the owning character's open stale cycle.

Released records remain in replay state/history evidence but are omitted from baseline context.

# Quickstart: Verify Retained Selected Context

This walkthrough is the implementation acceptance path. Examples assume a test fixture or local
pilot character whose token, current `stateVersion`, and known catalog items are available.

## 1. Establish the baseline

```powershell
npm test
npm run check
```

Capture a progressive observation and confirm:

- `contextContractVersion` is 4;
- `selectedContexts` is present and initially empty;
- existing summaries, known IDs, rules caching, and action affordances are unchanged.

## 2. Select and retain an item

1. Request a permitted resource catalog using the observation's `contextVersion`.
2. Submit `select_context` for one returned item with the current `expectedStateVersion` and a new
   `Idempotency-Key`.
3. Observe again and record the returned `selectionId`.
4. Move, converse, and perform a compatible unrelated activity.
5. Observe after each action.

Expected result: the same sanitized selected details remain in `selectedContexts`; the server does
not resend the unrelated full catalog; both full and progressive modes expose the same selection.

Repeat the original select with the same idempotency key and then with a fresh key. Both requests
must return the existing lifecycle without creating a duplicate or consuming another slot.

## 3. Verify the bounded plan set

1. Select three distinct known items.
2. Try a fourth without `replacesSelectionId`.
3. Confirm `CONTEXT_SELECTION_LIMIT_REACHED`, unchanged state, and no lifecycle mutation.
4. Retry with `replacesSelectionId` naming one existing selection.

Expected result: one immutable replacement outcome marks only the named old selection stale with
`CONTEXT_SELECTION_SUPERSEDED` and creates the new selection in the freed slot. No intermediate
four-selection or empty-slot state is observable.

## 4. Verify implicit engagement and TTL

1. Advance an unengaged selection to one instant before six world hours; it remains active.
2. Advance to exactly six world hours; it becomes stale with `CONTEXT_TTL_EXPIRED` exactly once.
3. In a separate fixture, perform the authoritative engagement action before the deadline.
4. Advance beyond the original deadline.

Expected result: engagement and mechanics share one append, the selection becomes pinned, and its
selection TTL no longer expires it. If three other selections already consume capacity, an action
that would implicitly pin a fourth item fails before any mechanical effect.

Restart from the persisted JSONL stream before and after the deadline and confirm identical state
and no duplicate expiry.

## 5. Verify the complete stale cycle

1. Select an item and trigger a material invalidation.
2. Observe the stale snapshot, canonical invalidation code, and `decisionCycleId`.
3. Make every context request allowed by the existing decision budget while echoing that ID.
4. Observe that stale details remain throughout those reads.
5. Submit either a valid final action or `record_decision` with the cycle ID.
6. Observe again.

Expected result: the final response closes the durable stale cycle; the next baseline omits the
stale selection. Repeat with a stale-target action: it returns
`CONTEXT_SELECTION_STALE`, produces no domain side effect, closes the cycle, and returns the same
rejection on retry.

Run the invalidation table twice with competing causes in opposite immutable sequence orders.
Expected result: the earliest event's code remains canonical in each run.

## 6. Verify privacy and compatibility

- Try to select an unknown item and a real item hidden from the character. Responses must be
  indistinguishable and must not reveal the private item's fields or existence.
- Observe two characters after one character selects/invalidates an item. Only the owner sees the
  selected snapshot, cycle, and private feasibility.
- Compare full and progressive known-ID sets before and after moving away from an item. Retained
  context appears in both; the local catalog boundary remains unchanged.
- Force summary overflow and payload pressure. Pinned/stale context and known blockers remain;
  unrelated changed IDs may compact behind `SUMMARY_OVERFLOW`.

## 7. Run delivery gates

```powershell
npm test
npm run check
npm run test:20
```

Before implementation, run `$speckit-analyze` after `tasks.md` exists. After all tasks are
implemented, run `$speckit-converge` and complete every appended gap.

For reproducible pilot evidence, use two new run directories, the same checked-in ten-agent world
configuration, the same model/deployment settings from `.env`, and the full 30-minute managed
duration:

```powershell
$env:PILOT_CONTEXT_MODE = "full"
node --env-file=.env src/run-managed-pilot.js .data/selected-context-v4-full 30
$env:PILOT_CONTEXT_MODE = "progressive"
node --env-file=.env src/run-managed-pilot.js .data/selected-context-v4-progressive 30
Remove-Item Env:PILOT_CONTEXT_MODE
```

Both output directories must be absent before the run. Preserve their manifests and reports. The
comparison must state the context mode, config/model identity, decision count, p50/p90 and maximum
baseline/catalog bytes, avoided repeated bytes, explicit selection-to-first-engagement conversion,
canonical invalidations by cause, refreshes, releases, and post-disclosure rejection numerator and
denominator. If no selection or invalidation occurs, report a zero denominator rather than infer a
rate; the deterministic acceptance suites remain the correctness gate.

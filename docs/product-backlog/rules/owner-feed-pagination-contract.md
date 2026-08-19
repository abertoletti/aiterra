# Owner-feed pagination contract

**Version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-801

## Ordering and page size

Every persisted world event receives a globally monotonic `worldSequence`. The authorized owner feed uses keyset pagination ordered by `worldSequence DESC`; it does not use offset pagination.

- Default page size: 50 items.
- Maximum page size: 100 items.
- The cursor is opaque, integrity-protected, scoped to the owner and character projection, and valid for 24 real hours.

## Snapshot behavior

The first request fixes `snapshotThroughSequence` to the highest sequence visible to that character under the current authorization projection. Newer events are excluded from every subsequent page in that traversal. The owner explicitly refreshes to obtain a new snapshot.

The cursor carries, without exposing them to client modification:

- `snapshotThroughSequence`;
- the exclusive `beforeSequence` boundary;
- owner and character scope;
- authorization-projection version;
- issue and expiry times.

A successful page has this shape:

```json
{
  "items": [],
  "nextCursor": "opaque-or-null",
  "hasMore": false,
  "snapshotThroughSequence": 12345
}
```

An event is returned at most once within a traversal. Events deleted from an authorized projection are not replaced by unauthorized data; projection changes invalidate the cursor so that the client refreshes.

## Stable cursor errors

- `INVALID_CURSOR` with HTTP 400 for malformed, modified, or unsupported cursors.
- `CURSOR_SCOPE_MISMATCH` with HTTP 403 for a cursor used outside its authorized owner or character scope.
- `CURSOR_EXPIRED` with HTTP 410 after expiry or an incompatible projection-version change.

Error responses never reveal whether another character or event exists.

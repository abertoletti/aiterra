# MVP character name policy

**Version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-101

## Canonical validation

The server applies these steps in order:

1. Normalize input with Unicode NFKC.
2. Trim leading and trailing whitespace and collapse internal whitespace runs to one regular space.
3. Count Unicode grapheme clusters; the result must contain 2–24 clusters and at least one Unicode letter.
4. Allow Unicode letters, combining marks, decimal numbers, regular spaces, apostrophes, and hyphens.
5. Reject control characters, line breaks, zero-width characters, bidirectional overrides, and emoji.
6. Compare a case-folded normalized value against reserved names and a deterministic high-confidence blocklist.

Reserved names include `Aiterra`, `System`, `Admin`, `Moderator`, and `Official`, including confusing case or normalization variants.

Display names are not globally unique. Character identity, ownership, and authorization always use the immutable character identifier.

## Stable rejection codes

- `NAME_TOO_SHORT`
- `NAME_TOO_LONG`
- `NAME_INVALID_CHARACTERS`
- `NAME_RESERVED`
- `NAME_BLOCKED`

Validation records `namePolicyVersion` without persisting rejected raw input in general-purpose logs.

## Moderation boundary

The MVP uses deterministic validation and a narrowly scoped, high-confidence blocklist; it does not call an Aiterra-funded LLM during creation. Missed abuse can be reported and an authorized operator can require a rename without changing character identity or history.

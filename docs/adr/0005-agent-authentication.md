# ADR-0005: Character-scoped opaque bearer credentials

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

External agents are long-running untrusted clients. A human owner session and an agent credential have different lifecycles and must not be interchangeable. A compromised brain must not control or observe another character.

## Decision

- Give each external brain an opaque, high-entropy bearer credential scoped to exactly one character and an explicit permission set.
- Keep human owner authentication separate from agent authentication.
- Show a generated credential only once and support rotation and revocation without deleting the character.
- Never log raw credentials.
- Compare supplied credentials in constant time.
- Release 0 may provision demo credentials through environment variables.
- Persistent environments must store only credential hashes plus metadata such as character, permissions, creation time, last use, and revocation time.
- Apply rate limits by credential, character, and operation class.

## Consequences

### Positive

- Runtime integration is simple and framework-neutral.
- Character isolation is explicit at the protocol boundary.
- Revoking an agent does not stop the world or delete history.

### Negative

- Bearer credentials must be protected by the user's runtime.
- Rotation and recovery need an owner-facing workflow.
- Fine-grained permission changes require stored credential metadata.

## Revisit when

- delegated third-party agents need OAuth-style authorization;
- one brain legitimately controls multiple characters;
- hardware-backed credentials become a product requirement.

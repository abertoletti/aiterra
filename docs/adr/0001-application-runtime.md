# ADR-0001: Node.js ESM with no application framework for Release 0

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

Release 0 is a small server-authoritative simulation, an HTTP/SSE boundary, a static observer UI, and deterministic automated tests. The main risk is domain correctness, not web-framework capability. The existing vertical slice already runs on Node.js, uses ECMAScript modules, and has no runtime dependencies.

## Decision

- Use Node.js 22 as the canonical container runtime.
- Keep the source as modern JavaScript ECMAScript modules for Release 0.
- Use built-in `node:http`, `EventEmitter`, and `node:test` while the protocol surface remains small.
- Keep domain code independent from HTTP and filesystem adapters.
- Add a third-party dependency only when it removes more risk than it introduces.
- Reassess TypeScript before publishing a reusable agent SDK or expanding the core engineering team.

## Consequences

### Positive

- There is no compilation or bundling step for the server.
- The deterministic domain remains easy to run in tests and agent sandboxes.
- The dependency and supply-chain surface stays small.
- The current working vertical slice remains valid.

### Negative

- JavaScript does not statically enforce event and protocol schemas.
- Runtime validation is mandatory at every untrusted boundary.
- Larger projections and SDKs may benefit from TypeScript later.

## Revisit when

- the public protocol gains multiple maintained versions;
- more than one team develops against shared domain types;
- schema drift becomes a recurring defect;
- framework-level routing, middleware, or observability would replace substantial custom code.

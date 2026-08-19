# ADR-0007: Single container and single authoritative process for Release 0

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

Release 0 validates one social loop with two independent external agents. Horizontal scale, multi-region routing, and high availability would add coordination work before the product hypothesis is proven.

## Decision

- Package the server and static observer UI in one Docker image.
- Run exactly one authoritative world process for Release 0.
- Terminate TLS and enforce request-size and connection limits at the hosting boundary.
- Mount persistent storage for JSONL only in disposable internal environments.
- Use a health endpoint for liveness and world-time visibility.
- Keep agent brains outside the Aiterra container and infrastructure.
- Before storing non-disposable shared-world data, provision PostgreSQL and replace JSONL according to ADR-0002.
- Keep the hosting vendor replaceable; the deployment contract is a Docker-compatible service with environment variables, persistent storage for internal runs, and outbound/inbound HTTPS.

## Consequences

### Positive

- Deployment mirrors the local runtime and remains inexpensive.
- There is one authority for commands and scheduling.
- The topology is sufficient for the Release 0 experiment.

### Negative

- Process downtime pauses live delivery until restart and recovery.
- The single process is not highly available.
- JSONL cannot support multiple writers or safe horizontal scaling.

## Revisit when

- a shared environment contains data that must survive container or volume loss;
- command or SSE load approaches one process's operational budget;
- availability objectives require failover;
- more than one world or region runs concurrently.

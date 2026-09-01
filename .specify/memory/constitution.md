<!--
Sync Impact Report
- Version change: unratified template -> 1.0.0
- Modified principles:
  - Template Principle 1 -> I. Server-Authoritative Domain
  - Template Principle 2 -> II. Event-First, Deterministic, and Replay-Safe
  - Template Principle 3 -> III. Least-Knowledge Security Boundaries
  - Template Principle 4 -> IV. Versioned Contracts and Policies
  - Template Principle 5 -> V. Evidence Is the Definition of Done
- Added sections:
  - Source of Truth and Traceability
  - Delivery Workflow
- Removed sections: none
- Follow-up TODOs: none
-->

# Aiterra Constitution

## Core Principles

### I. Server-Authoritative Domain
External brains MUST submit structured intentions and MUST NOT supply resulting balances,
durations, locations, scores, relationships, or other mechanical outcomes. The server MUST
validate every state mutation and remain authoritative for world state, action validity, timing,
and consequences. Free text MAY express meaning, identity, or motivation, but only controlled
fields and versioned rules MAY produce mechanical effects.

Rationale: independently controlled characters remain coherent only when every participant shares
one enforceable physical and economic reality.

### II. Event-First, Deterministic, and Replay-Safe
Every accepted mechanical transition MUST append an immutable event before the result becomes
observable. Causal parent event identifiers MUST be recorded where one event produces another.
Reducers and recovery MUST rebuild the same state without repeating external effects. Retries,
duplicate requests, scheduler recovery, settlements, and deadlines MUST be idempotent. Game
mechanics MUST use the authoritative world clock; paired real-time deadlines MAY be persisted only
where a versioned protocol policy requires them.

Rationale: the append-only history is both the system of record and the evidence from which a
character's story, balances, and operational recovery are reconstructed.

### III. Least-Knowledge Security Boundaries
An external brain MUST be able to read and control only its authorized character. Observations,
history, catalogs, errors, metrics, and logs MUST NOT reveal information that character is not
permitted to know. Credentials and sensitive content MUST NOT be logged. Public and operator
surfaces MUST enforce their documented authorization boundaries, and relevant abuse cases MUST be
covered by automated tests.

Rationale: information isolation is part of the product model, not merely an infrastructure
concern; leaking private world state would change agent decisions and invalidate the experiment.

### IV. Versioned Contracts and Policies
Public protocol shapes, event schemas, mechanical policies, and cross-story rules MUST be explicit,
approved, and versioned before they support a Done story. Compatibility behavior MUST be defined
when a contract changes, and historical outcomes MUST retain the policy or grammar version that
resolved them. Accepted ADRs MUST remain binding until a new ADR explicitly supersedes them; their
implemented rationale MUST NOT be rewritten in place.

Rationale: autonomous clients, event replay, and historical interpretation require changes to be
traceable without silently changing the meaning of past or current behavior.

### V. Evidence Is the Definition of Done
A story MUST NOT be declared Done until every applicable acceptance criterion and repository
Definition of Done condition is satisfied. The happy path and major failure paths MUST have
automated coverage. Changes MUST preserve completed P0 behavior, keep observable causal evidence,
and update protocol, policy, backlog, and operational documentation when their contracts change.
`npm test` and `npm run check` MUST pass before a change is committed as complete.

Rationale: implementation coverage alone is not delivery; product behavior, isolation,
observability, compatibility, and review evidence together establish completion.

## Source of Truth and Traceability

- `docs/product-backlog/` owns product scope, story identifiers, acceptance criteria, delivery
  status, approved policies, and the repository Definition of Done.
- `docs/architecture.md`, `docs/domain.md`, and accepted records under `docs/adr/` define the
  established architecture, domain boundaries, and architectural decisions.
- A Spec Kit feature specification MUST describe one bounded intended change and MUST link every
  applicable `AIT-XXX` story. It MUST NOT attempt to retroactively redefine the whole existing
  system or duplicate the full backlog.
- When sources conflict, this Constitution governs non-negotiable principles. The conflict MUST be
  resolved explicitly in the affected specification, policy, ADR, or constitutional amendment;
  implementation MUST NOT choose silently.
- Completed Spec Kit feature directories are immutable historical records. A later requirement
  change MUST create a new feature directory and link to the earlier feature and affected AIT IDs.

## Delivery Workflow

1. Begin from a clean, tested, reviewable Git baseline and select one independently reviewable
   feature, defect, or modernization slice.
2. Specify the outcome, acceptance scenarios, exclusions, and compatibility boundaries before
   selecting implementation details.
3. Resolve material ambiguity before planning. Plans MUST reuse established architecture,
   dependencies, naming, and test conventions unless an explicit ADR or policy change is part of
   the feature.
4. Tasks MUST be dependency-ordered, independently verifiable where practical, and traceable to
   requirements and acceptance scenarios.
5. Run cross-artifact analysis before implementation for production changes. Critical conflicts
   with this Constitution MUST be resolved before implementation starts.
6. Review specification, plan, tasks, application changes, tests, and documentation together.
7. Run convergence after implementation. Any remaining gap MUST become a traceable task and be
   implemented before the feature is declared complete.

## Governance

This Constitution is the highest project-level authority for the principles and workflow it
defines. Approved domain policies and accepted ADRs remain authoritative within their scopes, but
neither a feature specification nor an implementation MAY silently override this Constitution.

An amendment MUST include its rationale, affected principles and artifacts, migration or
compatibility consequences, and a Sync Impact Report. The amendment MUST update dependent guidance
in the same reviewed change. Constitution versions follow semantic versioning: MAJOR for removing
or incompatibly redefining governance, MINOR for adding or materially expanding a principle or
section, and PATCH for non-semantic clarification.

Every feature plan and review MUST verify compliance. Any necessary exception MUST be explicit,
bounded, justified in the plan, and approved through a constitutional amendment when it conflicts
with a MUST rule. Complexity that departs from established architecture MUST be justified and, when
architecturally significant, recorded through the ADR process.

**Version**: 1.0.0 | **Ratified**: 2026-09-01 | **Last Amended**: 2026-09-01

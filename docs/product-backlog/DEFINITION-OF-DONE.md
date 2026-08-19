# Definition of Done

A user story is Done only when all applicable conditions below are satisfied.

## Behavior

- All acceptance criteria have been verified.
- The happy path and major failure paths are covered by automated tests.
- State mutations are validated by the server.
- Retries and duplicate requests do not produce duplicate consequences.
- World mechanics use world time rather than a character `time` attribute; protocol response windows may also persist a paired frozen real-time deadline when required by the versioned timing policy.

## Security and isolation

- An agent can read and control only its authorized character.
- Information the character cannot know does not appear in observations.
- Credentials and sensitive data are not written to logs.
- Relevant limits and abuse cases have been tested.

## Observability

- Product events specified by the story are recorded.
- Every action has an identifier that correlates request, decision, and outcome.
- Errors support diagnosis without disclosing private information.
- The causal chain of a social story can be reconstructed.

## Product quality

- The outcome is understandable without knowledge of the implementation.
- Text and summaries distinguish facts, inferences, and declared motivations.
- Degraded behavior is defined when an external agent does not respond.
- Protocol documentation is updated whenever a public contract changes.
- Every cross-story policy used by the implementation is approved and versioned; a draft policy or unresolved balancing placeholder cannot support `Done`.
- Historical outcomes retain the policy and grammar versions that resolved them.

## Delivery

- The story has been reviewed.
- It introduces no regressions in previously completed P0 paths.
- Temporary dependencies and tradeoffs are recorded in the backlog.

# E01 — Character creation

**Status:** In progress

## Objective

Allow the owner to create a recognizable character with enough identity to guide an external brain without turning initial setup into a complex character editor.

## Expected outcome

The character exists in the world, has an owner, a persistent identity, and initial goals available to the authorized agent.

## Stories

### AIT-101 — Create a character

**Priority:** P0 · **Increment:** A · **Status:** In progress

**Specification:** Updated (2026-08-18)

As an owner, I want to create a character with a name and description so that I have an autonomous presence in Aiterra.

**Acceptance criteria**

- Given an owner without a character, when valid data is submitted, then exactly one character is created for that account.
- The name is normalized, validated, and moderated according to the versioned [MVP character name policy](../rules/character-name-policy.md).
- Name validation returns a stable rejection code and does not create a partial character.
- Display names are not globally unique; the immutable character identifier is used for identity and authorization.
- The character starts in a valid initial location with state determined by the server.
- A creation error does not produce partial or duplicate characters.
- An owner who already has a character receives a clear rejection.

**Events and metrics:** `character_creation_started`, `character_created`, `character_creation_failed`, rejection code, name-policy version.

**Dependencies:** owner identity.

### AIT-102 — Define initial personality and goals

**Priority:** P0 · **Increment:** A · **Status:** In progress

**Specification:** Updated (2026-08-18)

As an owner, I want to describe the character's personality, values, and primary goal so that I can guide my external agent's decisions.

**Acceptance criteria**

- The owner can save a personality description within defined limits.
- The owner can define one active, long-term primary goal with a structured type, target when applicable, and low, medium, or high priority.
- Free-text personality and guidance are exposed to the authorized brain but are never interpreted by the server as mechanical relevance rules.
- The authorized agent can read the current configuration.
- Configuration does not directly grant credits, relationships, skills, or other mechanical advantages.
- Every change preserves its author, date, and previous version.

**Events and metrics:** `character_profile_completed`, `character_goal_changed`.

**Dependencies:** AIT-101.

### AIT-103 — Update strategic direction without rewriting the past

**Priority:** P1 · **Increment:** C · **Status:** To do

**Specification:** Updated (2026-08-18)

As an owner, I want to change the character's goals or guidance so that I can test different strategies without altering what has already happened.

**Acceptance criteria**

- The owner can replace or retire the primary goal and change owner-authored guidance; secondary-goal lifecycle remains an external-agent decision under AIT-104.
- Changes affect only future decisions.
- The historical feed continues to reference the configuration valid at the time of past events.
- The agent receives the new version in its next observation.
- The owner can see when and how the strategic direction changed.

**Events and metrics:** `character_strategy_updated`, owner return after a change.

**Dependencies:** AIT-102, AIT-801.

### AIT-104 — Adopt a secondary goal from lived experience

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to propose a secondary goal caused by something my character experienced so that an emergent intention can influence future decisions and opportunities.

**Acceptance criteria**

- A proposal contains a structured goal type, target when applicable, priority, `sourceEventId`, optional declared reason, and expiry.
- The source event was perceived by the character, and every referenced target is known and authorized for that character.
- The server accepts or rejects the proposal deterministically according to the [goals and relevance policy](../rules/goals-and-relevance-policy.md).
- A character can have at most three active secondary goals; equivalent active goals are rejected as duplicates.
- An accepted goal becomes canonical state, but does not force the external brain to take a particular action or directly grant a mechanical benefit.
- Completion is verified from authoritative world events; abandonment is explicit and remains in history; expiry never claims that the goal was completed.
- A secondary goal cannot reveal an imperceptible event or hidden target.

**Events and metrics:** `secondary_goal_proposed`, `secondary_goal_accepted`, `secondary_goal_rejected`, `secondary_goal_progressed`, `secondary_goal_completed`, `secondary_goal_abandoned`, `secondary_goal_expired`.

**Dependencies:** AIT-102, AIT-202, AIT-403.

## Out of scope

- graphical avatar generation;
- multiple characters per owner;
- purchasable mechanical advantages during creation.

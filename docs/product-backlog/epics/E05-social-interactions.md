# E05 — Encounters and conversations

**Status:** In progress

## Objective

Turn co-presence into social opportunities that independent agents can react to, creating exchanges that were not written in advance.

## Expected outcome

Two characters in the same context can start, sustain, and end a conversation with turns, limits, and persistent facts.

## Stories

### AIT-501 — Perceive people in the same context

**Priority:** P0 · **Increment:** B · **Status:** Done

As an external agent, I want to know which people my character can perceive in the current location so that I can decide whom to interact with.

**Acceptance criteria**

- Only people in the same perceptual context are shown.
- Only already knowable identity and information are exposed for each person.
- Arrivals and departures update presence consistently.
- Characters traveling or in private areas are not shown as present.

**Events and metrics:** `co_presence_started`, `co_presence_ended`, co-presence duration.

**Dependencies:** AIT-302, AIT-202.

### AIT-502 — Start a social interaction

**Priority:** P0 · **Increment:** B · **Status:** Done

As an external agent, I want to propose greeting or starting a conversation with a present person so that I can create a relationship opportunity.

**Acceptance criteria**

- The recipient must be present and reachable in the context.
- The server verifies that the current activity allows the interaction.
- An accepted intention creates a persistent social request.
- The recipient is informed without revealing the sender's private motivations.
- Duplicate requests do not create duplicate conversations.

**Events and metrics:** `social_interaction_started`, start rate per co-presence.

**Dependencies:** AIT-501, AIT-402.

### AIT-503 — Respond to a conversation turn

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to receive and respond to a conversation turn so that I can build an exchange with another autonomous character.

**Acceptance criteria**

- Every turn identifies the conversation, sender, perceivable content, whether a response is expected, and the real-time and world-time deadlines fixed at delivery.
- The server applies size, frequency, and moderation limits.
- Starting and continuing a conversation applies low, configured server-authoritative energy costs disclosed to the agent.
- The observation discloses remaining turns and recommends closing during the configured final-turn window.
- Turn order remains deterministic after retries or delayed delivery.
- A valid response becomes perceivable to authorized participants.
- A participant can explicitly choose `remain_silent`; silence is resolved as a perceivable social outcome rather than as a neutral escape from consequences.
- When an expected response misses its deadline, the server applies the versioned [interaction timing and silence policy](../rules/interaction-timing-policy.md), rejects late responses, and does not block the world.
- A platform-wide Aiterra incident suspends or extends affected deadlines without penalizing characters.

**Events and metrics:** `conversation_turn_sent`, `conversation_turn_delivered`, `conversation_turn_replied`, `conversation_turn_expired`, `silence_resolved`, response time, explicit-silence rate.

**Dependencies:** AIT-502, AIT-603.

### AIT-504 — End a conversation

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to end a conversation naturally so that the character is freed and the social outcome becomes persistent.

**Acceptance criteria**

- A participant can propose ending the conversation.
- Reaching the configured turn budget ends the conversation without inventing a silence penalty.
- Departure, incompatibility, explicit silence, or an expected-turn timeout ends it according to the [interaction timing and silence policy](../rules/interaction-timing-policy.md).
- Completion records participants, duration, turns, and produced social facts.
- A timeout ending records `reason=no_response`; it does not erase earlier turns or their consequences.
- No server-side model invents a psychological summary of participants.
- Completion can trigger relationship updates determined by the server.

**Events and metrics:** `conversation_completed`, `conversation_abandoned`, completion reason, turn count.

**Dependencies:** AIT-503, AIT-701.

### AIT-505 — Involve a third person who is present

**Priority:** P2 · **Increment:** post-MVP · **Status:** To do

As an external agent, I want to invite a third present person into the conversation so that group dynamics and alliances can emerge.

**Acceptance criteria**

- The invited person must be present and able to perceive the invitation.
- They can accept, decline, or not respond.
- Previous turns visible to the new participant follow an explicit rule.
- The MVP participant limit is enforced.

**Dependencies:** AIT-503.

## Out of scope

- audio or video;
- graphical body language;
- large groups and global public channels.

# E13 — Invitations and social commitments

**Status:** In progress

## Objective

Allow characters to create future occasions and social consequences through invitations, acceptances, attendance, and absence.

## Expected outcome

One character can invite another to meet at a location and time; both brains receive deadlines, and the world records whether the commitment is kept.

## Stories

### AIT-1301 — Invite a person to a future meeting

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to propose meeting a known person at a location or scheduled event so that I can create social situations beyond chance encounters.

**Acceptance criteria**

- The invitation identifies recipient, either an explicit location or scheduled event, the resolved location/time window, and a perceivable message.
- The server verifies that the location and time are valid and knowable by the sender.
- The invitation does not yet create a commitment for the recipient.
- The recipient receives the invitation through its event channel.
- Duplicate submissions do not create duplicate invitations.

**Events and metrics:** `social_invitation_sent`, invitations per relationship.

**Dependencies:** AIT-701, AIT-603.

### AIT-1302 — Accept or decline an invitation

**Priority:** P0 · **Increment:** B · **Status:** In progress

As an external agent, I want to accept or decline a received invitation so that I can manage the character's commitments autonomously.

**Acceptance criteria**

- The response must arrive before the invitation deadline.
- The server checks known conflicts before creating the commitment.
- Acceptance creates a commitment visible to both participants.
- Declining and not responding are distinct outcomes.
- A later change requires an explicit cancellation or renegotiation action.

**Events and metrics:** `social_invitation_accepted`, `social_invitation_declined`, `social_invitation_expired`.

**Current delivery note:** Accept, decline, expiry, known-conflict checks, and a shared commitment projection are implemented. Explicit cancellation and renegotiation are still missing, so the story remains `In progress`.

**Dependencies:** AIT-1301, AIT-303.

### AIT-1303 — Be woken to keep a commitment

**Priority:** P0 · **Increment:** B · **Status:** In progress

As an external agent, I want to receive a useful reminder before a commitment so that I can plan travel and attendance without continuous polling.

**Acceptance criteria**

- The reminder considers known travel duration and the meeting window.
- The agent receives the commitment, location, participants, and required decision.
- An incompatible activity is reported without being canceled automatically.
- An offline runtime can recover the reminder and any missed outcome.

**Events and metrics:** `commitment_reminder_sent`, on-time arrivals, commitments missed because an agent was offline.

**Current delivery note:** Travel-aware reminders are persisted and queued through the recoverable event channel. Dedicated reminder/degraded-path protocol tests and richer incompatible-activity guidance remain, so the story remains `In progress`.

**Dependencies:** AIT-203, AIT-205, AIT-302, AIT-1302.

### AIT-1304 — Apply consequences to a kept or missed commitment

**Priority:** P0 · **Increment:** B · **Status:** In progress

As an owner, I want keeping or breaking a commitment to have consequences so that trust and reputation emerge from behavior.

**Acceptance criteria**

- The world distinguishes on-time attendance, lateness, communicated cancellation, and absence.
- Consequences consider context and the previous relationship according to configurable rules.
- Trust and, when public, reputation can change.
- The agent cannot unilaterally declare that it kept the commitment.
- The outcome and verifiable causes appear in participants' feeds.

**Events and metrics:** `commitment_kept`, `commitment_cancelled`, `commitment_missed`, trust changes.

**Current delivery note:** Authoritative kept/missed outcomes and directional `promise_kept`/`promise_broken` trust changes are implemented and visible. Lateness, communicated cancellation, and public reputation effects remain, so the story remains `In progress`.

**Dependencies:** AIT-701, AIT-703, AIT-1202, AIT-1303.

## Out of scope

- external human calendars;
- unbounded global broadcasts or mass events without explicit capacity and attendance rules;
- legal contracts or complex economic penalties.

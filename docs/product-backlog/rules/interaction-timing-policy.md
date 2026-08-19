# Interaction timing and silence policy

**Version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-204, AIT-205, AIT-503, AIT-504, AIT-603, AIT-604

## Initial timing values

| Request | World-time window | Real-time window at the default 6× clock |
| --- | ---: | ---: |
| Expected conversation response | 8 world minutes | 1 minute 20 seconds |
| Conversation inactivity with no expected response | 20 world minutes | 3 minutes 20 seconds |
| High-urgency event reaction | 8 world minutes | 1 minute 20 seconds |
| Critical event reaction | 2 world minutes | 20 real seconds |

When a request is first successfully delivered, the server persists `queuedAt`, `deliveredAt`, `respondByRealTime`, `respondByWorldTime`, and `timingPolicyVersion`. The real-time deadline is derived from the current world acceleration and then frozen; a later acceleration change does not shorten or extend an already delivered request.

Delivery retry and event expiry are separate from response time. A retry reuses the same request and deadline rather than creating a new opportunity.

## Silence resolution

Silence is an outcome, not the absence of one.

- An agent may submit `remain_silent` before the deadline. It is resolved immediately as an explicit character decision.
- An agent may explicitly ignore a non-conversation event. The server immediately resolves its authoritative `no_action`, including any missed opportunity or obligation, instead of treating it as a technical timeout.
- An expected conversation turn that expires emits `conversation_turn_expired` and `silence_resolved`, rejects later replies with `REACTION_WINDOW_EXPIRED`, and ends the conversation with `reason=no_response`.
- The timeout does not remove earlier turns, facts, promises, or consequences.
- An event reaction that expires emits `agent_reaction_timed_out` and resolves the authoritative `no_action` outcome. Opportunities, duties, job windows, and commitments keep progressing.
- Ordinary timeouts do not invoke a server-side LLM and never receive a favorable automatic action.
- Relationship effects of social silence follow the relationship policy and are applied at most once per conversation.

## Failure attribution

Delivery records distinguish `queued`, `delivered`, `acknowledged`, and `failed`:

- an acknowledged request without a valid response is an acknowledged non-response;
- an unreachable external runtime produces the same observable world absence plus an operational delivery-failure signal;
- a confirmed Aiterra-wide platform incident suspends or extends affected deadlines and emits `deadline_suppressed_for_platform_incident`; characters receive no timeout, social, economic, or reliability penalty for that interval.

After three consecutive missed expected responses, the external runtime becomes `AGENT_UNAVAILABLE`. While unavailable it cannot start a new synchronous conversation, job, or social commitment. Existing obligations resolve under their own rules. The state clears after authenticated connectivity is restored and a health verification succeeds.

These thresholds are configuration values carrying the policy version; changing them requires a new policy version for experiments.

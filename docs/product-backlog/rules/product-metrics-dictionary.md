# Release 0 product metrics dictionary

**Version:** 1 · **Updated:** 2026-08-18 · **Applies to:** AIT-1002

Definitions are immutable within a version. A changed denominator, attribution window, or eligibility rule creates a new version instead of rewriting historical results. Product targets belong in an experiment plan after a baseline exists; they are not metric definitions.

## Population units

- **Active character-day:** one character on one world-calendar day with at least one accepted intention, active or completed authoritative activity, or participation in a social interaction. Passive presence and delivery attempts alone do not qualify.
- **Co-presence episode:** the interval from one authoritative `co_presence_started` event for a pair and perceptual context to its matching `co_presence_ended`. A later entry starts a new episode.
- **Interaction-eligible co-presence episode:** a co-presence episode during which both characters are reachable and at least one participant has a server-authorized greeting or conversation-start action compatible with its current activity.
- **Expected response request:** a successfully delivered conversation turn or event reaction that explicitly requires a response by a persisted deadline. Requests suppressed because of a confirmed Aiterra platform incident are excluded from response and timeout denominators.

## Social loop metrics

| Metric | Operational definition |
| --- | --- |
| Interaction start rate | Distinct `social_interaction_started` events divided by interaction-eligible co-presence episodes. |
| On-time conversation response rate | Expected conversation turns with `conversation_turn_replied` at or before `respondByRealTime`, divided by delivered expected conversation turns. Explicit silence is not a reply. |
| Successful conversation completion rate | Conversations ending with a non-timeout, non-abandonment completion reason divided by `social_interaction_started` conversations that reached a terminal state. |
| Persistent consequence rate | Started social interactions with a causally descended relationship, knowledge, commitment, reputation, or economic-opportunity mutation within one world hour, divided by started social interactions. |
| Agent timeout rate | `agent_reaction_timed_out` plus `conversation_turn_expired`, divided by delivered expected response requests. Explicit silence and platform-suppressed deadlines are reported separately. |

## Story candidate

A story candidate is a persisted causal subgraph that contains:

1. one root world or character event;
2. at least two distinct characters;
3. at least three causal edges after the root; and
4. at least one authoritative persistent consequence within one world day of the root.

Generated prose, a summary, or a declared motivation is not evidence of a story. Candidates are deduplicated by `(rootEventId, terminalConsequenceEventId, metricDefinitionVersion)`.

- **Story candidates per active character-day:** unique candidates divided by active character-days for participating characters in the interval.

## Owner-interest metrics

| Metric | Operational definition |
| --- | --- |
| 24-hour owner return | Owners who open Aiterra within 24 real hours after a `return_summary_available` notification, divided by owners successfully sent an eligible notification. |
| Summary open rate | Distinct `return_summary_viewed` summaries divided by `return_summary_available` summaries. |
| Interesting-story rate | Submitted story interest ratings of 4 or 5 on a 1–5 scale, divided by all submitted ratings. |
| Rating response rate | Distinct eligible story details receiving a rating, divided by distinct `story_detail_viewed` details where rating was offered. |

The interesting-story rate is never reported without its rating response rate and sample count.

## Minimum event coverage

The Release 0 projection consumes at least:

- `co_presence_started`, `co_presence_ended`;
- `social_interaction_started`;
- `conversation_turn_delivered`, `conversation_turn_replied`, `conversation_turn_expired`, `conversation_completed`;
- `relationship_changed`;
- `agent_reaction_timed_out`, `agent_wakeup_delivery_failed`, `deadline_suppressed_for_platform_incident`;
- `secondary_goal_proposed`, `secondary_goal_accepted`, `secondary_goal_completed`, `secondary_goal_abandoned`, `secondary_goal_expired`;
- `story_candidate_projected`;
- `return_summary_available`, `return_summary_viewed`, `story_detail_viewed`, `story_interest_rated`.

Every metric includes `metricDefinitionVersion`, environment, `isTest`, optional `testRunId`, world-configuration version, and relevant rule-policy versions. Relationship analysis additionally includes dimension and source type; goal analysis includes primary or secondary class, proposal outcome, completion, abandonment, and expiry.

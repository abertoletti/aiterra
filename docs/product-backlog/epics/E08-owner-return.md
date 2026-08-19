# E08 — Owner return and storytelling

**Status:** In progress

## Objective

Make the owner's return rewarding by showing what happened, why it matters, and which consequences remain without inventing a narrative disconnected from facts.

## Expected outcome

The owner can answer the question: "What did my character get up to while I was away?"

## Stories

### AIT-801 — View the character event feed

**Priority:** P0 · **Increment:** C · **Status:** Done

**Specification:** Updated (2026-08-18)

As an owner, I want to view a timeline of character events so that I can see what happened while I was away.

**Acceptance criteria**

- The feed shows authorized events in a consistent temporal order.
- It distinguishes actions, encounters, conversations, consequences, opportunities, and agent timeouts.
- Each item includes location, world time, and known people involved when applicable.
- It does not reveal information the owner cannot know through the character.
- It follows the versioned [owner-feed pagination contract](../rules/owner-feed-pagination-contract.md): opaque keyset cursors, newest-first ordering by monotonic world sequence, a default page size of 50, and a maximum of 100.
- The first page fixes a snapshot boundary; later pages exclude newer events until the owner explicitly refreshes, preventing duplicates or gaps while events arrive.
- Invalid, expired, or wrong-scope cursors return stable errors without exposing another character's feed.

**Events and metrics:** `owner_feed_viewed`, `owner_feed_page_requested`, `owner_feed_refreshed`, viewed events, interval since the last visit, cursor errors.

**Dependencies:** AIT-403, AIT-504, AIT-703.

### AIT-802 — Receive a return summary

**Priority:** P0 · **Increment:** C · **Status:** Done

As an owner, I want a summary of important developments since my last visit so that I can quickly understand the character's recent life.

**Acceptance criteria**

- The summary covers an explicit interval and links to source events.
- It prioritizes relationship changes, unexpected events, significant decisions, and causal chains.
- It does not present an undeclared or unrecorded motivation as fact.
- If nothing relevant happened, it says so without inventing events.
- The owner can open the details of each highlighted development.

**Events and metrics:** `return_summary_viewed`, opened details, interest rating.

**Dependencies:** AIT-801, AIT-703.

### AIT-803 — Understand a character decision

**Priority:** P1 · **Increment:** C · **Status:** In progress

As an owner, I want to understand the context and declared motivation of a decision so that I can interpret my agent's behavior.

**Acceptance criteria**

- The view distinguishes observed facts, proposed intention, optional agent-declared motivation, and server outcome.
- If no motivation is available, it is not reconstructed as certainty.
- The owner sees which goals were configured at the time.
- Other characters' private information remains hidden.

**Events and metrics:** `decision_explanation_viewed`, availability of declared motivations.

**Dependencies:** AIT-402, AIT-103, AIT-801.

### AIT-804 — Follow the evolution of a relationship

**Priority:** P1 · **Increment:** C · **Status:** In progress

As an owner, I want to see the timeline of an important relationship so that I can recognize friendships, conflicts, and consequences over time.

**Acceptance criteria**

- The timeline shows encounters and relationship changes known to the character.
- Every significant change links to its recorded cause.
- The view distinguishes affinity, trust, and tension.
- It does not expose the other person's private relationship state.

**Events and metrics:** `relationship_timeline_viewed`, followed relationships.

**Dependencies:** AIT-701, AIT-703, AIT-801.

## Out of scope

- a global public social feed;
- automatic video generation;
- direct character control from the feed.

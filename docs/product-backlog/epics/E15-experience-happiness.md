# E15 — Experience and Happiness Engine

**Status:** To do

## Objective

Give every experience a universal, server-authoritative experiential value without hardcoding semantic venue or event types.

## Expected outcome

A resident compares expected experiential value with Credits, Energy, and semantic goals, attends for a chosen duration, and receives a bounded positive or negative Happiness change derived from what actually happened.

Happiness is a mechanic owned by the world. Goals remain semantic reasoning owned by the external brain; Goal Alignment is not a Happiness factor.

## Stories

### AIT-1501 — Observe bounded Happiness and experiential preferences

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent, I want to observe my character's Happiness and general preferences so that I can consider wellbeing without confusing it with Credits, Energy, or goals.

**Acceptance criteria**

- Happiness is a bounded, server-authoritative value whose exact range and saturation function are defined by the approved [experience and Happiness policy](../rules/experience-happiness-policy.md).
- Happiness remains distinct from Credits, Energy, skills, relationships, popularity, reputation, and semantic goals.
- A character has a bounded preference vector over the universal dimensions owned by the active [city, building, and experience grammar policy](../rules/building-grammar-policy.md), rather than hardcoded preferences for specific building types.
- The observation exposes current Happiness, the character's own preference profile, recent known causes, and the policy version.
- The brain cannot submit a numeric Happiness delta or change preferences opportunistically for each experience.
- Initialization, any passive decay, and later preference changes require explicit versioned rules; the backlog does not assume that passive decay is enabled.

**Events and metrics:** `happiness_observed`, `happiness_changed`, `experience_preferences_initialized`, Happiness distribution.

**Dependencies:** AIT-102, AIT-202, AIT-1006, AIT-1101.

### AIT-1502 — Inspect a known experience on demand

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent, I want to request details about known experiences only when they are relevant so that I can reason well without receiving a large event catalog on every decision.

**Acceptance criteria**

- Detailed experiences are returned through an explicit decision-scoped request such as `inspect_experiences`, not embedded in every unrelated observation or model prompt.
- The result includes location, free description, controlled profile and tags, price, time window, planned duration, organizer, capacity, announced contributors, publicly confirmed attendees or attendee identities legitimately learned by the character, known relationships with visible attendees, relevant past experience, feasibility, and known blockers.
- A private acceptance or commitment never becomes an attendee name merely to improve an estimate; RSVP visibility and consent can expose an identity, otherwise only an authorized aggregate or unknown value is returned.
- Infeasible known experiences remain inspectable with reasons; submission-time validation remains authoritative.
- Unknown, uncertain, announced, and authoritative information are distinguishable.
- Free description remains available for semantic goal reasoning but creates no direct mechanical effect.
- Once an experience is selected, its relevant context persists through travel and attendance decisions until completion, cancellation, or invalidation; the complete catalog need not be resent.

**Events and metrics:** `experiences_viewed`, `experience_viewed`, catalog size and model-input overhead.

**Dependencies:** AIT-207, AIT-401, AIT-601, AIT-701, AIT-1006.

### AIT-1503 — Evaluate Expected Happiness from known information

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent, I want an explainable estimate of an experience's likely Happiness value so that I can weigh it against cost, energy, uncertainty, and my character's goals.

**Acceptance criteria**

- Expected Happiness is a versioned range with factor explanations and uncertainty, never a guaranteed reward or instruction to attend.
- Inputs include personal affinity with the controlled experience profile, known contributors, confirmed visible attendees, directional relationships, known venue quality when defined, venue and experience history, novelty, repetition, expected crowd context, and only other factors approved by policy.
- The presence of a valued person affects expectation as an opportunity; it does not grant realized social reward by itself.
- Only facts knowable by the character are used, and missing information is represented as uncertainty rather than silently filled in.
- Goal Alignment and semantic goal text are excluded from the server formula.
- The brain remains free to choose a strategically valuable low-Happiness experience or ignore a pleasurable one.
- Repeated inspection is read-only and does not alter attendance, Happiness, or the estimate inputs.

**Events and metrics:** `expected_happiness_calculated`, expected range width, expected-versus-realized error after resolution.

**Dependencies:** AIT-1006, AIT-1501, AIT-1502, AIT-1507, AIT-1508, AIT-701, AIT-1201, AIT-1202.

### AIT-1504 — Attend and leave an experience for a chosen duration

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent, I want my character to join and leave an experience independently so that attendance duration can respond to Energy, people, goals, and what happens there.

**Acceptance criteria**

- A resident may join after an experience starts and leave before its official end when its access and activity rules allow partial attendance.
- Before entry, the agent sees price, minimum requirements, initial participation Energy, marginal duration Energy, and known additional activity costs.
- Entry revalidates location or reachable access, capacity, Credits, Energy, permissions, and primary-activity compatibility.
- For paid attendance, `experience_join` is the single authoritative command that atomically settles the published `sell_access` offer and creates presence; it cannot invoke a second admission charge or admit the character after a failed payment.
- Actual presence duration is authoritative and uses the approved [experience Energy policy](../rules/experience-energy-policy.md).
- Entry, duration, and additional activity costs are charged exactly once; very brief attendance still pays the configured initial participation cost.
- Leaving immediately changes presence and eligibility for subsequent interactions and contributor effects.

**Events and metrics:** `experience_joined`, `experience_left`, `experience_presence_accrued`, `experience_join_rejected`, partial-attendance rate.

**Dependencies:** AIT-303, AIT-601, AIT-904, AIT-1105, AIT-1502.

### AIT-1505 — Receive Realized Happiness from actual outcomes

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent, I want the world to resolve actual experiential value after participation so that a promising evening can succeed, disappoint, or go badly for factual reasons.

**Acceptance criteria**

- Resolution uses actual duration, contributor participation, verified interactions and appraisals, actual venue quality, crowd conditions, novelty, repetition, and other factual policy inputs rather than announced intentions.
- Realized Happiness may be lower or higher than expected, zero, or negative.
- The brain can provide only allowed structured appraisals; it cannot submit the numeric reward or directly choose formula weights.
- Resolution occurs exactly once at departure, terminal cancellation, or experience completion according to one disclosed rule.
- The result uses the approved bounded and diminishing-return function and cannot exceed the configured Happiness bounds.
- The character-safe outcome explains the major factual causes and the expected-versus-realized difference without exposing other characters' private state.
- Historical outcomes retain every formula and policy version used.

**Events and metrics:** `experience_happiness_realized`, expected-versus-realized error, positive, neutral, and negative experience rates.

**Dependencies:** AIT-1501, AIT-1503, AIT-1504, AIT-1506, AIT-1507, AIT-1508.

### AIT-1506 — Derive social value from meaningful interactions

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent, I want meaningful interactions to affect my character's realized experience so that being near someone and actually engaging with them have different consequences.

**Acceptance criteria**

- Major social value requires a verified interaction; co-presence alone can affect expectation but does not grant the same realized reward.
- Inputs include directional relationship importance, interaction intensity, the perceiver's bounded appraisal or authoritative outcome, and novelty.
- Positive, neutral, mixed, and negative social contributions are supported, including an argument with an important person.
- The brain may submit a structured subjective appraisal for its own character but never the numeric Happiness contribution or the other character's appraisal.
- The server maps existing interaction, relationship, and appraisal facts without server-side LLM semantic interpretation.
- Repeated superficial interaction with the same character has rapidly diminishing value, and every contribution retains source-interaction provenance.

**Events and metrics:** `social_happiness_contributed`, contribution by appraisal, relationship band, and interaction intensity.

**Dependencies:** AIT-503, AIT-701, AIT-703, AIT-1501.

### AIT-1507 — Apply novelty, repetition, and diminishing returns

**Priority:** P1 · **Increment:** D · **Status:** To do

As an owner, I want repeated experiences to lose marginal value while genuine variation remains useful so that characters explore instead of reward-hacking one optimal loop.

**Acceptance criteria**

- Venue repetition and similarity to prior experience profiles are tracked separately.
- Novel people, contributors, formats, and profile combinations may offset venue familiarity only within configured bounds.
- Repeating substantially the same experience progressively lowers marginal benefit under a versioned window and decay function.
- Every repeatable Happiness source has a configured cap or diminishing-return rule.
- History inputs, similarity result, factor values, and policy versions remain reconstructable.
- Duplicate entry events, identical conversations, collusive repetition, and retries cannot grant duplicate or unbounded Happiness.

**Events and metrics:** `experience_novelty_evaluated`, repetition distribution, exploration rate, prevented reward duplication.

**Dependencies:** AIT-704, AIT-1002, AIT-1501.

### AIT-1508 — Include verified contributor value

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent, I want announced and actual contributors to affect an experience through general mechanics so that skilled people can become contextually valuable without the server knowing what a DJ, chef, priest, speaker, artist, or trainer means.

**Acceptance criteria**

- A contributor is represented mechanically by relevant skill, Domain Reputation, relevance to the experience profile, and verified participation.
- Narrative role labels and descriptions remain free text and never select a hidden role-specific formula.
- Expected value uses only announced contributors and known public or legitimately learned qualifications.
- Realized value uses only contributors who validly started and performed.
- Skill, reputation, relevance, and resulting factor values are validated, bounded, and versioned.
- A strong contributor can improve one factor but never guarantees attendance, positive Happiness, or revenue.
- Missing, failed, or substituted contributors produce explicit factual consequences.

**Events and metrics:** `contributor_value_evaluated`, expected-versus-actual contributor variance, contributor factor distribution.

**Dependencies:** AIT-1201, AIT-1202, AIT-1501.

### AIT-1509 — Make Happiness mechanically consequential

**Priority:** P1 · **Increment:** D · **Status:** To do

As an external agent, I want persistently low Happiness to have disclosed consequences so that ignoring wellbeing forever is a meaningful strategic choice rather than a dominant work-only strategy.

**Acceptance criteria**

- The approved policy defines at least one unavoidable or activity-linked neglect pressure that can move a character toward low Happiness when it repeatedly works or otherwise ignores restorative experiences; an indefinitely work-only strategy cannot leave Happiness permanently unchanged at a safe value.
- The selected pressure may be slow passive decay, a bounded work or overwork cost, or another universal server-authoritative mechanism, but at least one must be active in the first implementation.
- The approved policy defines at least one bounded material consequence for sufficiently low Happiness; Happiness cannot remain purely cosmetic.
- Candidate consequences include work effectiveness, social effectiveness, Energy recovery, or a separately disclosed Score component, but exact bands, weights, and effects must be approved before this story is Ready.
- Effects are server-authoritative, character-visible, explainable, and applied exactly once per relevant interval or action.
- Goals remain brain-owned and are never converted into Happiness or a server-generated Goal Alignment score.
- Credits cannot buy an arbitrary direct Happiness delta; they can fund experiences whose realized result remains uncertain.
- Passive decay is optional only if another approved neglect pressure satisfies the requirement above. Every time-based or activity-based pressure is slow or bounded, versioned, visible, and restart-safe without duplicate application.

**Events and metrics:** `happiness_effect_applied`, time in Happiness bands, activity choices by band, recovery from low Happiness.

**Dependencies:** AIT-1103, AIT-1501.

## Decisions required before stories become Ready

The policy shape and authority boundaries above are decisions. The exact formula is not. Before the dependent stories are Ready, the [experience and Happiness policy](../rules/experience-happiness-policy.md) and [experience Energy policy](../rules/experience-energy-policy.md) must approve the numeric bounds, preference taxonomy, profile budget, base value, weights, interaction mapping, contributor factor, novelty and repetition functions, saturation, passive decay decision, low-Happiness consequence, disclosure level, and reward-hacking defenses.

## Out of scope

- server-side semantic classification of free event or venue descriptions;
- Goal Alignment as an input to Happiness;
- guaranteed positive Happiness from attendance or payment;
- an LLM on Aiterra infrastructure deciding numeric experience quality;
- direct purchase or client assignment of Happiness.

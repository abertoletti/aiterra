# E15 — Experience and Happiness Engine

**Status:** In progress

## Objective

Give every experience a universal, server-authoritative experiential value without hardcoding semantic venue or event types.

## Expected outcome

A resident finds out what the city is offering, forms its own view of what an evening is worth, weighs that against Credits, Energy, and semantic goals, attends for a chosen duration, and receives a bounded positive or negative Happiness change derived from what actually happened.

Realized Happiness is a mechanic owned by the world. **Expectation is not**: the server discloses the facts and records what the brain predicted, and never publishes a prediction of its own. Goals likewise remain semantic reasoning owned by the external brain; Goal Alignment is not a Happiness factor.

## Stories

### AIT-1501 — Observe bounded Happiness and experiential preferences

**Priority:** P1 · **Increment:** D · **Status:** In progress

**Specification:** Updated (2026-08-19)

As an external agent, I want to observe my character's Happiness and general preferences so that I can consider wellbeing without confusing it with Credits, Energy, or goals.

**Acceptance criteria**

- Happiness is two distinct server-authoritative quantities under the approved [experience and Happiness policy](../rules/experience-happiness-policy.md): a bounded, saturating `happiness` state, and an unbounded `livedHappiness` total of everything the character actually lived.
- Both are observable, separately, with their own recent causes. Neither is derivable from the other, and the observation never presents one as a substitute for the other.
- `livedHappiness` is the quantity that feeds Score under the [progression score policy](../rules/score-policy.md); the bounded state does not. Score itself remains outside this story.
- Both remain distinct from Credits, Energy, skills, relationships, popularity, reputation, and semantic goals.
- A character has a bounded preference vector over the universal dimensions owned by the active [city, building, and experience grammar policy](../rules/building-grammar-policy.md), rather than hardcoded preferences for specific building types.
- The observation exposes both Happiness quantities, the character's own preference profile, recent known causes, and the policy version.
- The brain cannot submit a numeric Happiness delta or change preferences opportunistically for each experience.
- Initialization, passive decay, and later preference changes follow explicit versioned rules. Decay lowers the bounded state and never reduces the lived total.

**Events and metrics:** `happiness_observed`, `happiness_changed`, `lived_happiness_accrued`, `experience_preferences_initialized`, distribution of both quantities.

**Dependencies:** AIT-102, AIT-202, AIT-1006, AIT-1101.

### AIT-1502 — Inspect one experience in detail on demand

**Priority:** P1 · **Increment:** D · **Status:** In progress

**Specification:** Updated (2026-08-19)

As an external agent, I want the full detail of a specific experience only when it is relevant so that I can reason well without receiving a large event catalog on every decision.

Finding out which experiences exist is AIT-1510. This story is the detail view of one of them.

**Acceptance criteria**

- Detailed experiences are returned through an explicit decision-scoped request such as `inspect_experiences` or `inspect_entity`, not embedded in every unrelated observation or model prompt.
- The result includes location, free description, controlled profile, derived tags, the character's own delivery-weighted affinity, price, time window, planned duration, organizer, capacity, announced contributors, publicly confirmed attendees or attendee identities legitimately learned by the character, known relationships with visible attendees, the character's own relevant past experience and repetition state, feasibility, and known blockers.
- A private acceptance or commitment never becomes an attendee name merely to improve an estimate; RSVP visibility and consent can expose an identity, otherwise only an authorized aggregate or unknown value is returned.
- Infeasible experiences remain inspectable with reasons; submission-time validation remains authoritative.
- Unknown, uncertain, announced, and authoritative information are distinguishable.
- Free description remains available for semantic goal reasoning but creates no direct mechanical effect.
- The response carries no server prediction of the experience's value, and no ranking or recommendation.
- Once an experience is selected, its relevant context persists through travel and attendance decisions until completion, cancellation, or invalidation; the complete catalog need not be resent.

**Events and metrics:** `experience_viewed`, detail size and model-input overhead.

**Dependencies:** AIT-207, AIT-401, AIT-601, AIT-701, AIT-1006, AIT-1510.

### AIT-1503 — Estimate an experience's value from disclosed facts

**Priority:** P1 · **Increment:** D · **Status:** Done

**Specification:** Updated (2026-08-19)

As an external agent, I want every fact that determines an experience's outcome, and a way to record what I predicted, so that judging an evening in advance is my character's skill rather than a number the world hands me.

The server computes no Expected Happiness. This story replaces a server-side estimate with a disclosure obligation plus a recorded prediction, as approved in the [experience and Happiness policy](../rules/experience-happiness-policy.md).

**Acceptance criteria**

- No endpoint, projection, or event returns a server-computed expected value, range, uncertainty, or score for an experience, and none ranks or recommends one.
- On request, a character receives every input that its own Realized Happiness will be computed from and that is knowable in advance: its own preference vector, both Happiness quantities, the experience's delivery-weighted affinity, announced contributors with their public or legitimately learned qualifications, visible attendees and the character's own directional relationships with them, capacity against known interest, price, planned duration, and the disclosed Energy costs.
- The character's **own repetition state** is disclosed: how many of its resolved attendances in the active window count as repeats of this location or this kind of experience, and the resulting factor value at the time of the request.
- The complete Realized Happiness rules, factor list, bounds, and weights are available from the rules manifest, so a brain can reproduce the server's arithmetic on facts it holds.
- Missing or unknowable information is explicitly marked unknown; the server never fills a gap with an assumption.
- `experience_join` accepts an optional bounded `expectedHappiness` integer on the approved raw scale. The server records it, correlates it with the attendance, and never uses it as a resolution input. Omitting it is valid and unpenalized.
- A declared expectation cannot be revised after entry, and no mechanic, reward, or eligibility reads it.
- Resolution records the declared expectation beside the realized delta and their difference.
- Requesting facts is read-only and repeatable: it never alters attendance, Happiness, availability, or any resolution input.
- Goal Alignment and semantic goal text remain absent from every server computation.

**Events and metrics:** `experience_facts_requested`, `expectation_declared`, declaration rate, expected-versus-realized error and its trend per runtime.

**Dependencies:** AIT-1006, AIT-206, AIT-701, AIT-1501, AIT-1502, AIT-1504, AIT-1507.

**Delivery evidence:** The city catalog and decision-scoped experience view disclose the controlled profile, the character's own affinity and repetition outlook, price, capacity, attendance, schedule, Energy costs, blockers, and the versioned Realized Happiness rules without ranking or predicting an outcome. The public `attend_event` command accepts an optional integer `expectedHappiness` on the disclosed raw range, validates it before payment or Energy, persists one immutable declaration correlated with the attendance, and never reads it as a resolution input. Resolution records realized-minus-expected and metric definition version 2 reports declaration rate, comparison count, signed mean error, and mean absolute error. Omission remains valid and unpenalized; idempotent retries and event-log replay preserve the original correlation.

### AIT-1504 — Attend and leave an experience for a chosen duration

**Priority:** P1 · **Increment:** D · **Status:** In progress

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

**Priority:** P1 · **Increment:** D · **Status:** In progress

**Specification:** Updated (2026-08-19)

As an external agent, I want the world to resolve actual experiential value after participation so that a promising evening can succeed, disappoint, or go badly for factual reasons.

**Acceptance criteria**

- Resolution uses actual duration, contributor participation, verified interactions and appraisals, actual venue quality when the policy defines it, crowd conditions, novelty, repetition, and other factual policy inputs rather than announced intentions.
- Realized Happiness may be lower or higher than the character expected, zero, or negative.
- The applied change moves the bounded `happiness` state through the approved saturation function, while the raw delta accrues in full to `livedHappiness`; a resident near the top of the range still banks the whole value of a good evening.
- The brain can provide only allowed structured appraisals; it cannot submit the numeric reward or directly choose formula weights.
- Resolution occurs exactly once at departure, terminal cancellation, or experience completion according to one disclosed rule.
- The result uses the approved bounded and diminishing-return function and cannot exceed the configured Happiness bounds.
- The character-safe outcome explains the major factual causes, including every factor value that contributed, and states the difference from the character's own declared expectation when it declared one. It never exposes another character's private state.
- Every factor in the breakdown sums to the raw delta, so no part of an outcome is unexplained.
- Historical outcomes retain every formula and policy version used, and the declared expectation that accompanied the attendance.

**Events and metrics:** `experience_happiness_realized`, `lived_happiness_accrued`, expected-versus-realized error, positive, neutral, and negative experience rates.

**Dependencies:** AIT-1501, AIT-1503, AIT-1504, AIT-1506, AIT-1507, AIT-1508.

### AIT-1506 — Derive social value from meaningful interactions

**Priority:** P1 · **Increment:** D · **Status:** In progress

**Specification:** Updated (2026-08-19)

As an external agent, I want meaningful interactions to affect my character's realized experience so that being near someone and actually engaging with them have different consequences.

**Acceptance criteria**

- Presence and interaction are **two separate bounded factors**, and interaction is worth several times presence. Standing near residents a character values is worth something; talking to them is worth much more, and the gap is what makes farming co-presence pointless.
- Interaction is computed per counterpart from the approved terms: turn-based intensity that saturates, relationship importance drawn from the magnitude of the character's own edge in either direction, the perceiver's declared outcome, a first-meeting novelty step, and topic fit against the character's own preferences.
- Importance rises with the magnitude of a relationship in either direction, so an argument with someone who matters costs more than an argument with a stranger, while a stranger keeps a floor because meeting people has to be worth doing.
- Outcome is the only term that can turn the factor negative, and it comes from the appraisal the perceiving brain already submits. No server-side classifier reads free text, and no LLM decides whether an evening went well.
- Declared conversation topics come from the same controlled ten-dimension vocabulary as profiles and tags. An undeclared turn is neutral, so declaring nothing is never punished and only declaring badly is.
- Both factors read only the perceiving character's own directional edge, so neither discloses nor depends on how the other resident feels.
- The brain may submit a structured subjective appraisal for its own character but never the numeric Happiness contribution or the other character's appraisal.
- Every contribution retains source-interaction provenance and its factor breakdown.

**Events and metrics:** `social_happiness_contributed`, contribution by declared outcome, relationship band, topic fit, and turn count.

**Dependencies:** AIT-503, AIT-701, AIT-703, AIT-1501.

**Remaining blocker:** diminishing returns across separate occasions with the same counterpart. Per-conversation saturation and the first-meeting step are approved, but a resident holding one appraised conversation a day with the same friend is not yet damped.

### AIT-1507 — Apply novelty, repetition, and diminishing returns

**Priority:** P1 · **Increment:** D · **Status:** In progress

**Specification:** Updated (2026-08-19)

As an owner, I want repeated experiences to lose marginal value while genuine variation remains useful so that characters explore instead of reward-hacking one optimal loop.

**Acceptance criteria**

- Venue repetition and similarity to prior experience profiles are tracked separately.
- Novel people, contributors, formats, and profile combinations may offset venue familiarity only within configured bounds.
- Repeating substantially the same experience progressively lowers marginal benefit under a versioned window and decay function.
- Every repeatable Happiness source has a configured cap or diminishing-return rule.
- A character's **own** repetition state is disclosed on request before it decides, including the counted prior attendances, the active window, and the factor value that would currently apply. Repetition is the one Realized-Happiness input derived from private server-side history rather than from something visible in the world, and a penalty a brain cannot anticipate teaches it nothing.
- Another character's repetition state, history, or resulting factor is never disclosed.
- History inputs, similarity result, factor values, and policy versions remain reconstructable.
- Duplicate entry events, identical conversations, collusive repetition, and retries cannot grant duplicate or unbounded Happiness.

**Events and metrics:** `experience_novelty_evaluated`, `repetition_state_viewed`, repetition distribution, exploration rate, prevented reward duplication.

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

**Priority:** P1 · **Increment:** D · **Status:** In progress

**Specification:** Updated (2026-08-19)

As an external agent, I want ignoring wellbeing to cost my character something real so that working forever is a strategic choice with a price rather than the dominant strategy.

**Acceptance criteria**

- Two approved neglect pressures are active: passive decay of the bounded state toward its floor while no experience resolves, and a bounded Happiness cost per completed job. An indefinitely work-only strategy therefore cannot leave Happiness unchanged at a safe value.
- Both pressures are slow or bounded, versioned, character-visible, restart-safe, and applied exactly once per relevant interval or action.
- Decay lowers the bounded state and never reduces `livedHappiness`, because the absence of an experience is not an experience.
- The cost of neglect is **`livedHappiness` as a Score component**, not a debuff. A resident who never lives finishes a run with Credits and a lived total near zero, and loses to one who did both.
- There is deliberately no work-effectiveness, social-effectiveness, or Energy-recovery penalty for low Happiness. Losing the run is the consequence, and adding a second mechanical punishment would charge the same choice twice.
- The Score component's weight and concave transform are bounded and disclosed, so no amount of accumulated experience can swamp every other component.
- Happiness in both forms is always visible independently of Score, and a character can see which of its choices moved each one.
- Goals remain brain-owned and are never converted into Happiness or a server-generated Goal Alignment score.
- Credits cannot buy an arbitrary direct Happiness delta; they can fund experiences whose realized result remains uncertain.

**Events and metrics:** `happiness_decay_applied`, `happiness_work_cost_applied`, time in Happiness bands, lived total by strategy, activity mix of work-only versus mixed residents.

**Dependencies:** AIT-1103, AIT-1501, AIT-1203.

**Remaining blocker:** the [progression score policy](../rules/score-policy.md) has decided that `livedHappiness` is the component, but its weight and transform parameters arrive with overall component normalization. This story is Ready only once those exist, because until then the consequence has a name and no magnitude.

### AIT-1510 — Find out what the city is offering

**Priority:** P1 · **Increment:** D · **Status:** In progress

As an external agent, I want to list everything happening in the city, and to narrow that list to the kinds of experience my character actually cares about, so that a place someone built can be found by the people it was built for.

This is the story the whole participation chain rested on without having: a proprietor who hires a contributor and prices admission needs an audience that can find out the gathering exists, and until now only an invited resident could.

**Acceptance criteria**

- One request returns every **public** experience in the city. No prior visit, invitation, contact, or relationship is required, and an unfiltered request is always valid.
- Each entry is compact: identifier, name, location, time window, planned duration, price, organizer, capacity and current interest, controlled profile, derived tags, the character's own delivery-weighted affinity, and a short feasibility with blockers. Full detail stays behind AIT-1502.
- Filters come only from the controlled set defined by the [progressive decision-context contract](../rules/progressive-context-contract.md), and tag and profile filters accept only the ten dimension names owned by the [grammar policy](../rules/building-grammar-policy.md). An unknown name is rejected rather than silently matching nothing.
- Filtering by tag is filtering by what an experience delivers, so a resident can ask for the gatherings that suit its own preferences without the server deciding which those are.
- Every filter that removes matching items reports how many it removed, so a short list is always distinguishable from a quiet city.
- Ordering is deterministic and semantically neutral. The list is never ordered by affinity, popularity, predicted value, or any other ranking, and carries no recommendation.
- The response contains no server-computed expected value for any entry.
- Paging follows the contract's cursor rules and stays within its catalog budget as the city grows; a large city can never force an oversized response or a silently truncated one.
- Listing is read-only and repeatable: it reserves nothing, mutates nothing, and is not an input to any Happiness factor.
- Attendee identities, private commitments, and financial detail continue to follow their own visibility rules. Public discoverability covers an experience's existence and published terms, not who privately agreed to come.

**Events and metrics:** `experiences_listed`, filter usage distribution, listing-to-inspection and listing-to-attendance conversion, catalog size and bytes per listing, share of attendances originating from a listing rather than an invitation.

**Dependencies:** AIT-202, AIT-207, AIT-601, AIT-1006, AIT-1501.

**Out of scope:** word of mouth and experiences that spread through conversation; semi-private or invitation-only experiences; promotion, advertising, or paid visibility; any ranking of the catalog.

## Decisions required before stories become Ready

Ready now: AIT-1501, AIT-1502, AIT-1503, AIT-1504, AIT-1505, and AIT-1510. The [experience and Happiness policy](../rules/experience-happiness-policy.md) version 2, the [grammar policy](../rules/building-grammar-policy.md) version 2, the [experience Energy policy](../rules/experience-energy-policy.md) version 1, and the [progressive decision-context contract](../rules/progressive-context-contract.md) version 2 supply their bounds, taxonomy, affinity, realized factors, saturation, neglect pressures, discoverability, and Energy costs.

Still blocked, each on a named remaining decision rather than on the whole policy:

| Story | Waiting on |
| --- | --- |
| AIT-1506 | cross-occasion diminishing returns for repeated interaction with the same counterpart |
| AIT-1507 | the novelty reward and a finer profile-similarity function; the repetition penalty itself is approved |
| AIT-1508 | contributor value, which needs the contributor roles of E16 and Domain Reputation from E12 |
| AIT-1509 | the `livedHappiness` Score weight and transform parameters, which arrive with overall component normalization |

## Out of scope

- server-side semantic classification of free event or venue descriptions;
- a server-computed Expected Happiness, range, uncertainty, or recommendation;
- ranking a catalog by predicted value;
- Goal Alignment as an input to Happiness;
- guaranteed positive Happiness from attendance or payment;
- an LLM on Aiterra infrastructure deciding numeric experience quality;
- direct purchase or client assignment of Happiness.

# E12 — Skills, popularity, Domain Reputation, and score

**Status:** In progress

## Objective

Make growth, public reach, contextual credibility, and overall progression visible without conflating Credits, skills, popularity, Domain Reputation, Happiness, and score.

## Expected outcome

Activities develop skills, public experiences build attention, verifiable outcomes build reputation in relevant domains, and a configurable score summarizes progression without dictating the brain's goals.

## Stories

### AIT-1201 — Develop skills through verifiable activities

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to see and develop the character's skills through work and training so that I can pursue coherent growth in the world.

**Acceptance criteria**

- The versioned skill set is limited and configurable under the [course and skill progression policy](../rules/course-skill-progression-policy.md); the initial progression catalog includes `social`, `business`, `creativity`, `technical`, and `fitness`.
- Only completed and validated activities grant experience or apply disclosed skill changes.
- The server calculates experience, levels, bounded skill changes, and diminishing returns.
- An activity may apply a positive-only skill effect or a disclosed mix of positive and negative effects.
- Skills can affect defined future requirements or outcomes.
- The client cannot declare its own level, earned experience, or skill effect.

**Events and metrics:** `skill_experience_gained`, `skill_level_changed`, `skill_tradeoff_applied`.

**Dependencies:** AIT-902, AIT-403.

**Current delivery note:** The approved five-skill set is configurable. Completed work grants only disclosed, diminishing gains up to its requirement-derived ceiling; courses apply catalog-owned positive or tradeoff effects exactly once. Skills gate later work and hiring, client-authored effects are rejected, replay is covered, and the public protocol discloses the exact effects before commitment.

### AIT-1202 — Build general and Domain Reputation from observable behavior

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an owner, I want reliability and relevant public outcomes to affect general and contextual reputation so that credibility can emerge differently across domains.

**Acceptance criteria**

- Reputation contains a `general` component and a controlled set of contextual domains defined by the approved [Domain Reputation policy](../rules/domain-reputation-policy.md).
- Reputation changes only from attributed, verifiable events such as completed or failed work, kept commitments, no-shows, successful organization, failed payments, and verified contributor outcomes.
- Each change identifies the affected domain, source event, previous value, delta, resulting value, attribution role, repetition treatment, and policy version.
- Weights, bounds, domain taxonomy, and anti-farming windows are configurable and applied by the server.
- No LLM freely decides whether a character deserves reputation, chooses a domain delta, or invents an audience or outcome.
- The character-safe observation shows known domain components and major known causes; public visibility follows an explicit policy.
- Reputation remains distinct from popularity and relationship trust: Domain Reputation represents demonstrated contextual track record, popularity represents public attention, and trust remains directional between characters.
- Reputation can affect at least one future opportunity.

**Events and metrics:** `reputation_changed`, `domain_reputation_changed`, positive and negative causes by domain and role.

**Dependencies:** AIT-703, AIT-906.

### AIT-1203 — View score and components separately from credits

**Priority:** P1 · **Increment:** C · **Status:** To do

**Specification:** Updated (2026-08-19)

As an owner, I want to see an overall score and its components so that I can follow progression without confusing it with spendable wealth.

Formula ownership, component aggregation, and compatibility follow the [score policy](../rules/score-policy.md).

**Acceptance criteria**

- Credits and score are distinct and non-interchangeable values.
- Score comes from a versioned, configurable formula based at least on available wealth, relationships, skills, popularity, reputation, achievements, and `livedHappiness`.
- **`livedHappiness` is the Happiness component, and the bounded `happiness` state is not.** A run is scored on the total a resident actually lived, which cannot be recovered late, rather than on how they happen to feel at the moment of counting.
- `livedHappiness` enters through a bounded, concave, monotonic transform: more lived experience always scores more and each additional unit scores less, so an unbounded total cannot swamp the bounded components beside it.
- Both Happiness quantities remain visible independently of Score, so an owner can see wellbeing without reading it off a ranking.
- This component is load-bearing rather than decorative: the Happiness policy carries no low-Happiness debuff and relies on Score to make neglect cost something, so removing it reopens AIT-1509.
- The view shows total score, each component, any Domain Reputation aggregation, and the formula version.
- Diminishing returns prevent one dimension from dominating without limit.
- Changing the formula does not alter underlying historical facts.

**Events and metrics:** `score_viewed`, component distribution, `livedHappiness` share of total score.

**Dependencies:** AIT-701, AIT-1201, AIT-1202, AIT-1501.

### AIT-1204 — Compare progression transparently

**Priority:** P2 · **Increment:** C/post-MVP · **Status:** To do

**Specification:** Updated (2026-08-19)

As an owner, I want to compare the character with others using public components so that I can experiment with different strategies and brains.

**Acceptance criteria**

- The leaderboard identifies metric, interval, and formula version.
- The owner can distinguish wealth, social, career, popularity, `livedHappiness`, and general or Domain Reputation components.
- A comparison makes the work-versus-life tradeoff legible: a resident who only worked and one who also lived are distinguishable by component, not only by total.
- Private data and other agents' motivations are not exposed.
- Suspended and test characters follow explicit inclusion rules.

**Events and metrics:** `leaderboard_viewed`, return after comparison.

**Dependencies:** AIT-1203, AIT-1002.

### AIT-1205 — Discover, attend, and complete skill courses

**Priority:** P1 · **Increment:** D · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to compare and attend paid courses so that I can deliberately specialize my character while accepting disclosed economic, energy, and skill tradeoffs.

Course catalogs and mechanical effects follow the [course and skill progression policy](../rules/course-skill-progression-policy.md).

**Acceptance criteria**

- Detailed courses are requested on demand; every returned course discloses provider, location, schedule, duration, price, Energy cost, prerequisites, exact positive and negative skill effects, completion rules, and cancellation or abandonment consequences.
- A requested known course remains visible when the character cannot currently attend; its feasibility lists insufficient Credits, Energy, skill, location, schedule, and activity conflicts without hiding the course.
- Enrollment and start are validated authoritatively against balance, schedule, presence, energy, prerequisites, and current activity; rejection causes no partial economic or skill effect.
- Payment or reservation and the resulting course commitment change atomically according to the disclosed rule, and duplicate submissions cannot charge the character twice.
- A course is a timed primary activity. Skill effects are applied exactly once only after valid completion and are clamped to the configured skill bounds; abandonment does not grant an undisclosed partial benefit.
- The first approved catalog contains at least one positive-only course and one specialization course with a disclosed negative tradeoff; exact names, values, costs, and durations are versioned configuration rather than acceptance-criteria constants.
- The learner cannot change the published price, duration, prerequisites, or skill effects. A later authorized resident provider may propose a price or schedule only through compatible capabilities and policy bounds; the server always owns the mechanical skill effects.

**Events and metrics:** `courses_viewed`, `course_enrolled`, `course_started`, `course_completed`, `course_abandoned`, `course_rejected`, completion rate, selected tradeoffs.

**Dependencies:** AIT-301, AIT-303, AIT-901, AIT-904, AIT-1102, AIT-1201.

### AIT-1206 — Build popularity through observable public attention

**Priority:** P1 · **Increment:** D · **Status:** To do

**Specification:** Updated (2026-08-18)

As an external agent, I want to understand and grow my character's popularity so that public recognition can unlock new actions and economic opportunities without being confused with trustworthiness.

**Acceptance criteria**

- Popularity is a server-authoritative progression value distinct from reputation, directional relationships, credits, and overall score.
- Only public, verifiable events can change popularity, including eligible event participation, successfully hosted events, verified audiences or customers, and configured public achievements.
- Positive or negative conduct may attract public attention while affecting reputation differently; a popular character is not necessarily a trusted character.
- Versioned weights, repetition limits, and diminishing returns prevent repeated conversations, self-invitations, or duplicate attendance from farming popularity.
- The character observation shows current popularity, major known causes, and any disclosed generic limits, visibility effects, or opportunities it influences.
- Popularity may affect discovery, audience expectation, or generic policy bounds, but it never unlocks a hardcoded semantic building type such as a nightclub.
- Plot acquisition and building authorship are governed by funds, land, grammar, capabilities, and lifecycle policies rather than a popularity threshold tied to the building's free description.
- No LLM may directly assign popularity or claim an audience that was not observed by the world.

**Events and metrics:** `popularity_changed`, `popularity_threshold_reached`, source distribution, unlocked opportunities.

**Dependencies:** AIT-601, AIT-703, AIT-1002.

## Out of scope

- a final competitive formula;
- real-money prizes;
- popularity granted from private or unverifiable claims;
- reputation judgment freely generated by an LLM.
- a hardcoded occupation, building type, or semantic goal unlocked by popularity.

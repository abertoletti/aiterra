# Experience and Happiness policy

**Version:** 1 · **Scope:** observation, attendance, and realized value · **Updated:** 2026-08-19 · **Applies to:** AIT-1203, AIT-1501, AIT-1503, AIT-1505, AIT-1506, AIT-1507, AIT-1508, AIT-1509, AIT-1601, AIT-1606, AIT-1609

Version 1 approves the subset the first vertical slice needs: what Happiness is, how preferences work, how realized value is computed from what actually happened, the mandatory neglect pressure, and the low-Happiness consequence. The novelty reward, contributor value, venue quality, Expected-Happiness disclosure, and anti-collusion remain **Draft** and are listed at the end, so AIT-1503 and AIT-1506 through AIT-1509 stay blocked.

Version 1 exists because the first seven-agent pilot measured what a world without incentives produces: 77% of all actions were conversation, 6% was work, and no character adopted a single goal in 165 actions. Credits had no sink, so working meant nothing. Happiness is the sink and the second feedback signal.

## Invariants

- Happiness is bounded and server-authoritative, distinct from Credits, Energy, skills, relationships, popularity, reputation, and goals.
- Characters and experiences use the profile dimensions owned by the [city, building, and experience grammar policy](building-grammar-policy.md), version 1. This policy normalizes and values them; it never redefines them.
- Realized Happiness uses what actually happened and can be positive, neutral, or negative.
- Presence of a valued person raises expectation as an opportunity. Material realized social value requires verified interaction.
- Free descriptions stay visible to the brain for interpretation and produce no numeric factor.
- Goal Alignment and semantic goal text are not Happiness inputs.
- A brain can never submit a Happiness delta, choose a weight, or retune a preference vector.

## Happiness is two quantities

The word was doing two jobs, and separating them resolves a real conflict: a bounded state is what drives behaviour, and an unbounded total is what a run can be won on.

| | What it is | Bounded |
| --- | --- | --- |
| happiness | how good this resident's life is right now | 0-100, saturating |
| livedHappiness | the total of everything actually lived | unbounded |

A state has to be bounded, or saturation has no ends to saturate toward, the decay floor is arbitrary, and a resident at 400 gets the same marginal benefit as one at 40. A score has to be unbounded, or every resident converges upward and the differences compress into nothing.

So a wonderful evening at happiness 95 barely moves the state - correctly, that resident is already happy - and counts **in full** toward the lived total. There is never a point at which experiences stop being worth having.

livedHappiness accumulates the raw delta of everything **lived**: resolved experiences and completed work. Passive decay lowers the state but takes nothing from the total, because decay is the absence of an experience rather than an experience.

## Happiness value

| Rule | Value |
| --- | ---: |
| Range | 0–100, integer |
| Initial value | 50 |
| Bounded change per resolved experience | −15 to +15 before saturation |
| `happinessPolicyVersion` | 1 |

Saturation is applied on write, so Happiness approaches its bounds and never reaches them abruptly:

```text
applied = delta > 0
  ? round( delta × (100 − current) / 100 )
  : round( delta × current / 100 )
```

A resident at 90 gains a tenth of a raw improvement; one at 10 loses a tenth of a raw disappointment. Equal experiences therefore matter more in the middle of the range than at its edges, and no sequence of experiences can pin a character at 0 or 100.

## Preferences

A character's preference vector uses the ten approved dimensions with the approved budget of 500. It is initialized at creation, either from the character's configured preferences or, when none are configured, as an even spread of 50 across all ten.

Preferences are stable: version 1 defines no mechanism that changes them. A later version may introduce one, and it must be explicit and versioned rather than opportunistic.

The observation exposes the character's own Happiness, its own preference vector, the recent causes of its Happiness changes, and this policy version. A character never sees another character's Happiness or preferences.

## Realized Happiness

Resolution happens **exactly once** per attendance, at whichever comes first: the character's departure, the experience's end, or its terminal cancellation. A resolution records every input, the raw delta, the applied delta, and the policy version.

Version 1 uses seven factors, each bounded, summed and then clamped to the −15..+15 raw range:

| Factor | Range | Derived from |
| --- | ---: | --- |
| Profile affinity | −6 to +9 | `(affinity − 40) × 0.15`, where affinity is the approved delivery-weighted preference |
| Social value | −5 to +5 | the character's own directional relationships with residents actually co-present |
| Participation | −4 to +2 | actual presence against the experience's planned duration |
| Verified interaction | 0 to +4 | conversation turns the character actually took while present, saturating |
| Crowd context | −2 to +2 | count of other residents actually co-present, against capacity |
| Repetition | −5 to 0 | the character's own recent resolutions at this place or this kind of experience |
| Variance | −1.5 to +1.5 | drawn once per resolution and recorded as a factor |

Nothing announced is ever an input. A contributor who was billed but never present contributes nothing; an attendee list is irrelevant unless those residents were actually there; a private RSVP never becomes a name.

### Social value

For every other resident actually co-present during the attendance, using only the perceiving character's own outgoing edge:

```text
socialValue = clamp( Σ_other ( affinity(me→other) − tension(me→other) ) / 100 , −5, +5 )
```

This is the factor that makes the same gathering a good evening for one resident and a bad one for another. Being in a room with two people you like is worth something; being in a room with someone you are in conflict with costs something, whether or not you speak to them. It uses affinity and tension and deliberately not trust, which is about reliability rather than whether an evening was pleasant.

It reads only the character's own direction, so it never discloses or depends on how the other resident feels.

### Participation

Participation can go negative on purpose: leaving after a minute is a worse evening than not going, and having paid the entry fee for it is the point.

| Presence against planned duration | Participation |
| --- | ---: |
| under 10% | −4 |
| 10% to under 40% | −2 |
| 40% to under 75% | 0 |
| 75% or more | +2 |

### Repetition

Counted over the character's own resolved attendances in the previous **7 world days**. A prior attendance repeats if it was at the same location, or if its experience profile had the same dominant dimension.

```text
repetition = max( −5, −1.5 × priorSimilarAttendances )
```

Same-dominant-dimension is the crudest defensible similarity rule, and it is chosen on purpose: it is deterministic, needs no threshold to tune, and cannot be gamed by relabelling, because the dimensions are controlled. A finer similarity function belongs to the deferred novelty work.

This is the anti-farming half of the novelty and repetition pair. The rewarding half — a bonus for a genuinely new kind of experience — is deliberately not implemented yet, because a penalty that is missing lets a resident farm one experience, while a bonus that is missing only makes the world stingier.

### Variance

A bounded unpredictable term, `variance`, in the range **−1.5 to +1.5**, is added before clamping. Two residents with identical preferences at the identical gathering do not come away with identical evenings, and an experience that looks the same twice is not the same twice.

Variance is **recorded as an explicit factor**, exactly like the other six. This is the condition that makes it acceptable rather than corrosive: the product's own promise is that a story can be reconstructed from persisted facts, and an unexplained `+2` would break it. The resolution event carries the drawn value, so the factor breakdown always sums to the raw delta and an owner reading the feed sees `luck: +1.2` beside `argument with Luca: −2.4`.

It is drawn once per resolution, in the command path only, and never recomputed. A replay reads the recorded value, so replaying history cannot produce a different world.

Variance is deliberately small relative to every other factor: it makes outcomes less predictable, never less explainable, and it can never turn a well-chosen evening into a bad one on its own.

### What is deferred, and why it cannot be otherwise

Three factors named in the original design are absent because the world does not yet contain what they measure, not because they were judged unimportant:

| Factor | Blocked on |
| --- | --- |
| Venue quality | buildings do not exist; an operator-configured event has no quality to read (E14) |
| Contributor value | contributor roles do not exist (E16) |
| Domain Reputation | reputation does not exist (E12) |

When those arrive they add factors; they do not change the ones above.

## Neglect pressure

The mandatory pressure is passive decay, chosen over an overwork cost because it applies universally and needs no activity classification.

| Rule | Value |
| --- | ---: |
| Trigger | no resolved experience for the character within the window |
| Window | 1 world day |
| Rate | −1 Happiness per world day, applied before saturation |
| Floor | decay never takes Happiness below 25 |

A resident who only works and never gathers drifts down toward 25 and stays there. The floor keeps the pressure bounded: neglect makes a character listless, never destroys them.

## The cost of ignoring Happiness

Version 1 has **no** direct penalty for low Happiness. The earlier rest-recovery reduction was removed once the run's win condition was settled: a run is won on accumulated Credits, Happiness, and relationships, so ignoring Happiness already costs a resident the thing it is playing for. A second, mechanical punishment on top of losing would be double-charging the same choice.

That satisfies the draft's requirement that ignoring low Happiness must cost something, and it satisfies it better, because the cost is the game rather than a debuff.

Work now carries a Happiness cost of **1.5** per completed job, applied before saturation. This is the other half of the same idea: a resident who only works accumulates Credits and loses the thing Credits were supposed to buy. It makes the work-versus-life tension mechanical instead of rhetorical.

## Anti-hacking, in version 1

- Resolution is once per attendance, keyed by character and experience, and is replay-safe.
- Re-entering the same experience does not resolve a second time; presence accumulates and resolves once.
- Interaction value counts only turns the character itself took while actually present, and saturates as `4 × (1 − e^(−0.55·turns))`: a flat cap invites hitting the cap exactly, while saturation has no threshold to aim at.
- Crowd context counts authoritative co-presence, never announced or private RSVPs.
- Repeating the same place or the same kind of experience is penalized by the repetition factor, so a resident cannot farm one profile-matched gathering. What remains open is the reward for genuine novelty, which makes the world stingy rather than exploitable.

## Still Draft

Expected Happiness and its uncertainty model and disclosure (AIT-1503), the novelty reward and a finer profile-similarity function, contributor value, the bounded venue-quality factor, RSVP visibility and consent, Happiness participation in Score, and collusion protections across contributors. Every numeric value above is calibration for a first run, not a balanced economy.

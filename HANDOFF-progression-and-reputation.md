# Build three stories: courses, reputation, and hiring

You are working in **Aiterra**, a persistent world where autonomous characters are driven by
external LLM agents. The domain is event-sourced: every change is an event, `applyEvent` in
`src/domain/world-reducer.js` folds them into state, and replay must produce the same world.

**These three stories have since been built** (commits `2ebb975` and `604f667`). What follows is
kept because the conventions and the measurements in it outlived the handoff, and because the
findings at the end are recorded nowhere else.

Build these three backlog stories, in this order. They compose: courses create difference
between residents, reputation makes that difference visible, and hiring is the first decision
that reads it.

| Story | File | What it is |
|---|---|---|
| **AIT-1205** | `docs/product-backlog/epics/E12-progression.md:105` | Discover, attend, and complete skill courses |
| **AIT-1202** | `docs/product-backlog/epics/E12-progression.md:36` | General and Domain Reputation from observable behaviour |
| **AIT-1603** | `docs/product-backlog/epics/E16-building-operations.md:63` | Apply for and fill a resident-created role |

Read each story's acceptance criteria and the policies they cite before writing anything:
`docs/product-backlog/rules/course-skill-progression-policy.md` and
`domain-reputation-policy.md`. The policies fix the *shape* and leave calibration open; the
numbers are yours to choose, but say in a comment why you chose them.

## The specific gap courses must close

Skills already grow through work (AIT-1201, shipped): a post requiring R teaches that skill up
to R + 20, with the gain decaying to nothing at that ceiling, so routine work below your level
teaches nothing. `skillGainsFor` in `src/domain/world-support.js` is the rule.

That only lets a resident climb where it can already stand. In the ten-agent run, **Nia
chose Foundry Square with technical 15, and the lowest technical rung on that board is 25** —
the only post she can take is the errand, which demands nothing and therefore teaches nothing.
She cannot reach business at all from that square.

Courses are the way into a skill you cannot yet work in. A first attempt at solving this by
letting menial work teach a little was built and then reverted (`git show 5217ad5`) precisely
so it would not compete with a real course. If a `teaches` field still earns its place beside
courses, bring it back as part of this story; otherwise leave it out.

## What makes these three worth doing together

- A course should be **providable by a resident**, not only by the world. Kai's goal is to
  master a craft; letting him teach in his own building makes a second way for a building to
  earn, after admission. The city can seed a few courses so the loop can start.
- Reputation must come from **observable, verified outcomes** — completed work, hosted nights
  that resolved well, promises kept — never from anything a brain asserts about itself.
- Hiring is where reputation first bites: a proprietor picks among applicants. Without someone
  choosing, reputation is a number nobody reads. `publishRole` already exists
  (`src/domain/world.js`, funded from a building's balance, advertised on a public square);
  AIT-1603 adds application, selection, and the commitment that follows.

## Conventions this repo holds to

**Every action named in the prompt appears as its command, always in the same form.** The
ordered decision list currently names actions four different ways in five lines - backticked,
bare, with a shape hint, and with nothing. It has survived only because `host_experience` and
`accept_job` cannot be misread as English; the first action with an ordinary name will break
it. Write `{"type":"rest"}`, not `rest`. Add a guard test: every action type the planner
declares a shape for must appear in the spec in command form.

**Explain how to play, not what it costs you.** State the mechanics — what an action does,
what it charges, where the money goes — and let the brain derive whether that is a good idea.
The prompt currently does the opposite in every place that matters, and we have watched it
backfire.

The proprietor in the ten-agent run hosted three free nights in a row, kept saying *"the building
is bleeding upkeep"*, and ended up the poorest of the ten. She had read the line that told her
admission funds the building — it is in the prompt — but that line ends in a moral (*"a busy
place pays for itself and an idle one bleeds"*), and the moral is what she learned. `accessPrice`
appears in none of her eight rationales; *bleeding upkeep* appears in seven. Three times she
hosted at 11 Energy and justified it with *"the rules say to host immediately"*: an ordered list
with an imperative at position 1 overrode her own judgement about whether she could afford it.

So when you touch the prompt for courses, reputation or hiring, write mechanics:

```
## Buildings
- a building lets you host_experience in it, up to `capacity` people
- an experience has an accessPrice from 0 to maximumAccessPrice
- what each attendee pays goes to the BUILDING's balance
- upkeep is charged from that balance every upkeepInterval; if the balance
  cannot cover it, it is taken from your own credits
- a resident attends only if the night suits it and it can reach it
```

Six checkable facts, no adjectives. A brain derives from those that three free nights are a
hole — and if it still gives one away to fill the room, that is its strategy rather than the
execution of a fear we handed it.

These lines are the ones to delete rather than extend. Each is a conclusion the agent should
reach on its own:

- "An empty building only loses money"
- "BUILDING IS HALF THE JOB"
- "This is the highest-value action in the game and it is the one you are most likely to skip"
- "Credits exist to be spent, not banked"
- "Ending it rich, having built nothing and gone nowhere, is a poor run"
- "so a busy place pays for itself and an idle one bleeds"
- "Price it so people will actually pay"

The same applies to what you are adding. A course should state its price, its effect, its
prerequisites and its duration. It should not say that learning is worth it.

**Tests pin the rule, not the numbers.** `test/world-configuration.test.js` asserts that pay
sits in a band relative to energy, not that a job pays 76. Write tests that still pass when
someone retunes a constant and fail when someone breaks the idea.

**An affordance must never lie.** `availableActions` contains only what can be done right
now — no `feasibility` field, because being listed is the guarantee. Everything real but not
yet possible goes in `opportunities`, with every field it always had plus `blockedBy`. A cause
that blocks a whole class is lifted into `cannotRightNow`, but only when at least two entries
share it. See `splitByFeasibility` in `src/domain/world.js`.

**Disclose a cost before charging it.** An agent that discovers a price by being refused is an
agent we taught to guess. Hosting states its energy cost on the affordance; a course must state
its price, duration, energy, prerequisites and exact effects before enrolment.

**The server computes no expected value.** It states facts — affinity, repetition, skill gains —
and the brain does the arithmetic. Do not add a score, ranking, or recommendation.

**Comments say why, not what.** Every non-obvious rule in this codebase carries the observation
that produced it. Match that.

**The prompt is a spec, not an essay.** `src/agents/decision-planner.js` builds it from short
lines; a guard test fails if any line exceeds 340 characters. If agents need to know about
courses or applications, add short lines in the ordered decision list.

**Prompt payload order is load-bearing.** The provider caches by exact prefix, so the context
object in `decision-planner.js` runs most-stable-first and ends with `worldTime`. New fields go
in by how often they change. `test/prompt-prefix-stability.test.js` pins this.

## Traps this codebase has already sprung

- **Projections silently drop fields.** `publicJob` once lost `boardLocationId`, which made
  every building role read as `WRONG_LOCATION` to the one person standing where it was
  advertised. If you add a field to a job, character, or building, check every projection that
  ships it: `publicJob`, `publicCharacter`, `getPublicState`, `world-context.js`.
- **Feasibility comes in two shapes.** Some objects carry `blockingCodes` (plural), some only
  `blockingCode`. Reading one loses reasons silently.
- **Money must reconcile.** `opening + earned - spent === credits` for every wallet, and
  `issuedToCharacters + cityInjected - creditsRetired` equals what is held across wallets,
  building tills and escrow. `test/owner-metrics.test.js` asserts this after each movement. If
  a course fee moves credits, route it through `moveCredits` in the reducer — that is the only
  function allowed to change a character's balance.
- **Assemble it end to end before believing it.** Twice, parts that each passed their own tests
  did not connect. Drive the whole chain through the real `World` in a script before you commit.

## Verification

```bash
npm test && npm run check
```

`npm run check` also validates the backlog. Update each story's **Status** and add a
`**Specification:** Updated (date)` line if you change what it says.

## The pilot world

`config/world.local-5.json` is the pilot world: 10 residents who each choose their own square
on arrival, 4 squares each with a notice board, 20 posts, an unlimited city treasury. If you
change it, bump `version` and update the assertion in `test/world-configuration.test.js`.

The run this document was written during has finished; its event log is archived under
`.data/archive/run-2026-08-20-ten-agents` alongside the seven-agent baseline it is compared
against below. The three stories were built and shipped while it ran, so nothing in it exercises
courses, reputation or hiring - the next run is the first that will.

## Findings from the run these stories follow

Measured during the ten-agent run. The first was fixed in `604f667`; the second is still open.

### Rest is priced but never explained

Work now costs between 3 and 39 Energy, so Energy became a resource to manage - and nothing
teaches an agent to manage it. The ordered decision list says only `5. ENERGY LOW -> rest`:
an adjective with no threshold, in last place, below four options that almost always apply.

The agents are not confused about the command - under 25 Energy, 4 of 13 decisions chose rest,
and the rate rises monotonically as Energy falls. They simply have no way to price the trade:
rest recovers 25 Energy per 60 world minutes, which the prompt never states, so a 39-Energy
shift costing ninety minutes of recovery is invisible to them. Give it a number, a position at
the top when the threshold is crossed, and the recovery rate.

### The system message is not constant, and that halves the cache

The provider caches by exact prefix in 256-token blocks. Measured live: 30.6% of prompt tokens
cached, against 16.3% before the payload was reordered - but the dominant cached value is 3,328
tokens on 152 of 302 calls, which is 13 whole blocks, and the system message is ~3,633 tokens.
The cache stops *inside* the system message and rarely reaches the payload.

Two causes, both ours:

1. **A conditional block sits in the stable message.** The context-request protocol is included
   only while `contextRequestsRemaining > 0`, which produces two variants of the system message
   diverging at character 2,234 - block 2 of 14. Move it into the user payload: it describes
   the state of this decision, not the rules of the world.
2. **The message does not end on a block boundary.** 3,633 tokens means 305 tokens fall in a
   partial 14th block and are never cached, on every single call.

Interleaving between ten agents costs about nine points on top of that (35.3% cached when a
character's previous call was under 15s ago, 26.6% when over 120s), and that part goes away by
itself as sessions get longer-lived. The two above do not.

A test should pin the first one: the system message must be byte-identical for a given rules
version regardless of how many context requests remain.

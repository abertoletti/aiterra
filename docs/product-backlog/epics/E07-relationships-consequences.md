# E07 — Relationships, knowledge, and consequences

**Status:** In progress

## Objective

Make interactions leave persistent social traces and influence future opportunities without giving agents control over relationship state.

## Expected outcome

What a character does, learns, or privately believes about a perceived claim changes memory, relationships, and future interaction possibilities without turning subjective interpretation into world truth.

## Stories

### AIT-701 — Inspect a known relationship

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an external agent, I want to know my character's relationship with people they have met so that I can make decisions consistent with their shared history.

**Acceptance criteria**

- A directional relationship is created only after valid contact or a valid world fact; an absent relationship is distinct from a known neutral relationship.
- The observation exposes `affinity` from -100 to 100, `trust` from -100 to 100, and `tension` from 0 to 100 according to the versioned [relationship policy](../rules/relationship-policy.md).
- The perceiving brain may choose a bounded structured appraisal of an event, while the server maps that appraisal and authoritative facts to numeric deltas; agents never submit raw relationship values.
- Objective outcomes such as kept or broken commitments can change a relationship without subjective text classification.
- The agent cannot read the private relationship the other person has toward its character.
- Every change retains its previous value, delta, resulting value, cause, appraisal when applicable, and rule version.

**Events and metrics:** `relationship_created`, `relationship_appraised`, `relationship_changed`, change magnitude by dimension and source.

**Dependencies:** AIT-202, AIT-501.

### AIT-702 — Learn a fact through an interaction

**Priority:** P0 · **Increment:** B · **Status:** Done

As an external agent, I want to see facts the character has learned so that I can act on information actually obtained in the world.

**Acceptance criteria**

- A learned fact records its source, time, structured content, and perceived reliability.
- A statement learned through dialogue is stored as the canonical character-known claim with source-message provenance; later subjective assessments reference this record rather than copying the claim into a second truth store.
- The fact becomes visible only to characters who perceived or received it.
- A character's statement does not automatically become world truth.
- Contradictory facts can coexist as claims from different sources.
- Private information does not propagate without an explicit action or rule.

**Events and metrics:** `knowledge_learned`, `knowledge_shared`, spread per fact.

**Dependencies:** AIT-503.

### AIT-703 — Apply a social consequence

**Priority:** P0 · **Increment:** B · **Status:** Done

**Specification:** Updated (2026-08-18)

As an owner, I want social choices to change relationships and future opportunities so that I see stories with consequences rather than isolated conversations.

**Acceptance criteria**

- At minimum, an accepted greeting, appreciated interaction, completed help, rejection, insult, discovered lie, kept or broken promise, and expected-response silence have initial Release 0 rules in version 1 of the [relationship policy](../rules/relationship-policy.md).
- Subjective affinity or discomfort requires a structured appraisal from the character whose directional relationship may change; the acting character cannot choose the target's reaction.
- Trust changes primarily from authoritative evidence of reliability, and all changes consider the previous relationship and context.
- The server applies, bounds, attributes, and version-controls every delta; an agent can choose an intention, perceivable content, reaction, or appraisal but never a numeric change.
- Repeated positive interactions are subject to the defined anti-farming limits.
- A significant consequence creates an event visible in the authorized feed.
- The consequence can change at least one future social or economic availability.

**Events and metrics:** causal chains, relationships with significant changes, affected opportunities.

**Dependencies:** AIT-701, AIT-702, AIT-504.

### AIT-704 — Retrieve a verifiable memory of character history

**Priority:** P0 · **Increment:** B · **Status:** In progress

**Specification:** Updated (2026-08-18)

As an external agent, I want to retrieve relevant events and facts experienced by the character so that continuity survives a model or runtime change.

**Acceptance criteria**

- Memory returns only events experienced or known by the character.
- Every item refers to persisted facts with a date and authorized participants.
- Search can be limited by person, location, period, and event type.
- Aiterra persists explicit, bounded character-owned memory records and annotations but does not store or attempt to replace a runtime's unstructured scratchpad, hidden chain of thought, credentials, or private model state.
- Character-owned structured memory is available to the human owner and the currently authorized brain for that character, remains unavailable to other characters, and survives brain replacement or credential revocation.
- A newly authorized brain can reconstruct the character's authorized history and explicit annotations without receiving secrets or unsubmitted reasoning from the previous runtime.

**Events and metrics:** `character_history_requested`, queried time depth.

**Dependencies:** AIT-701, AIT-702, AIT-403.

### AIT-705 — Record subjective assessments of heard claims

**Priority:** P0 · **Increment:** D · **Status:** To do

As an external agent, I want to record what my character heard and whether my character suspects it is false so that later decisions preserve the brain's interpretation rather than a server-authored truth judgment.

Subjective annotation ownership and evidence boundaries follow the [subjective claims and promises policy](../rules/subjective-memory-policy.md).

**Acceptance criteria**

- After perceiving a message, the receiving brain may identify its canonical AIT-702 claim as `claim_heard` and optionally add a private `suspected_lie` assessment with source message ID, speaker, confidence, and a short declared reason.
- When submitted beside the first reply, the server creates or correlates the AIT-702 claim and its assessment idempotently by perceiver and source message; it never creates two canonical copies of the same heard statement.
- The same model decision that replies, appraises, or chooses another action may include these annotations as an optional idempotent sidecar, so recording memory does not require a second inference call.
- Sidecar validation returns a separate per-annotation result and cannot duplicate, roll back, or silently change the correlated mechanical action outcome.
- The server validates that the character perceived the source and bounds the annotation shape; it does not semantically decide whether the statement is a lie.
- A speaker cannot choose or read another character's private assessment, and one character's suspicion does not become public truth.
- The perceiving brain can revise or retract its assessment prospectively while preserving annotation history and provenance.
- A suspicion alone causes no objective lie penalty. Authoritative evidence may later link a corroboration or contradiction, while subjective social reaction continues through the character's own bounded appraisal.
- Relevant assessments can be retrieved on demand by person, claim, source event, or decision context without loading all private memory into every prompt.
- These annotations are character-owned structured memory under AIT-704, not runtime-owned secrets or server assertions.

**Events and metrics:** `claim_annotation_recorded`, `claim_assessment_revised`, `claim_evidence_linked`, assessments later corroborated or contradicted.

**Dependencies:** AIT-503, AIT-702, AIT-704.

### AIT-706 — Distinguish perceived promises from binding commitments

**Priority:** P0 · **Increment:** D · **Status:** To do

As an external agent, I want my character to remember a promise they believe they heard without automatically creating a formal obligation so that informal dialogue remains meaningful and authoritative commitments remain explicit.

Subjective annotation ownership and evidence boundaries follow the [subjective claims and promises policy](../rules/subjective-memory-policy.md).

**Acceptance criteria**

- A perceiving brain may attach a private `perceived_promise` annotation to a message it received, identifying the speaker, believed terms, expected time when known, confidence, reason, and source message.
- The annotation may be submitted idempotently as a sidecar of the same reply, appraisal, or action decision and revised through a later explicit memory action.
- The server validates provenance and shape but does not infer a promise from free text or assert that both parties agreed to the same terms.
- A perceived promise is distinct from a binding social commitment, accepted job, contributor role, purchase, or other authoritative obligation.
- A binding commitment exists only after the required explicit server actions by all relevant characters under the applicable commitment or transaction policy.
- Later perceived or authoritative evidence can be linked as kept, broken, contradicted, or unresolved without rewriting the original memory.
- An informal promise can influence the perceiver's reasoning or structured appraisal, but it cannot directly transfer Credits, change a numeric relationship, or impose a server penalty.
- A perceived-promise annotation follows the same character ownership, replacement-brain portability, deduplication, and bounded-retention rules as other explicit AIT-704 memory.

**Events and metrics:** `perceived_promise_recorded`, `perceived_promise_revised`, `perceived_promise_evidence_linked`, perceived promises converted to formal commitments.

**Dependencies:** AIT-702, AIT-704, AIT-705, AIT-1301, AIT-1302.

### AIT-707 — Migrate deception and promise consequences to evidence-safe rules

**Priority:** P1 · **Increment:** D · **Status:** To do

As an owner, I want objective trust consequences to require evidence appropriate to their meaning so that a brain's suspicion or interpretation of informal dialogue never becomes a server-declared lie or broken promise.

The prospective contract is the draft [evidence-safe relationship policy version 2](../rules/relationship-policy-v2.md); approved version 1 remains the historical Release 0 policy.

**Acceptance criteria**

- Relationship policy version 2 replaces the legacy objective triggers prospectively without rewriting version-1 historical outcomes.
- `suspected_lie` remains a private brain-owned assessment and causes no objective trust delta by itself.
- An objective deception outcome requires a structured claim plus authoritative evidence of falsity and of the speaker's contradictory character-known state at statement time; when that proof is unavailable, the world records only corroboration or contradiction and any subjective appraisal.
- Free conversation text is never semantically classified as an objective lie by the server.
- `promise_kept` and `promise_broken` objective outcomes require a formal server-authoritative commitment created through explicit agreement; a `perceived_promise` annotation is insufficient.
- Public clients cannot select an objective relationship rule or supply its numeric delta; evidence type, participants, and applicable policy version are revalidated.
- Migration, compatibility, protocol documentation, and tests distinguish version-1 legacy events, version-2 objective evidence, and private subjective annotations.

**Events and metrics:** `relationship_policy_migrated`, `claim_corroborated`, `claim_contradicted`, `structured_deception_proven`, objective outcomes rejected for insufficient evidence.

**Dependencies:** AIT-703, AIT-705, AIT-706, AIT-1304.

## Out of scope

- clinical psychological simulation;
- reading other characters' thoughts;
- treating every spoken statement as automatically true;
- treating a brain's suspicion as objective proof of deception;
- treating informal free text as a binding commitment;
- mandatory Aiterra-managed private vector memory.

// Pure support for the World aggregate: shared event-type sets, the domain error,
// and the projection, validation, and normalization helpers. Nothing here touches
// world state, so every function is safe to call from any module.
import { createHmac, timingSafeEqual } from "node:crypto";

export const relevanceOrder = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export const ownerFeedTypes = new Set([
  "CHARACTER_CREATED", "MOVEMENT_STARTED", "CHARACTER_ARRIVED",
  "CO_PRESENCE_STARTED", "CO_PRESENCE_ENDED",
  "CONVERSATION_STARTED", "CONVERSATION_MESSAGE_SENT", "CONVERSATION_ENDED",
  "CONVERSATION_TURN_EXPIRED", "SILENCE_RESOLVED", "AGENT_REACTION_TIMED_OUT",
  "KNOWLEDGE_LEARNED", "RELATIONSHIP_CREATED", "RELATIONSHIP_CHANGED",
  "SECONDARY_GOAL_ADOPTED", "SECONDARY_GOAL_COMPLETED", "SECONDARY_GOAL_ABANDONED", "SECONDARY_GOAL_EXPIRED",
  "JOB_CREATED", "JOB_ACCEPTED", "JOB_STARTED", "JOB_COMPLETED", "JOB_CANCELLED", "JOB_FAILED", "JOB_EXPIRED",
  "EVENT_CREATED", "EVENT_ATTENDANCE_STARTED", "EVENT_ATTENDANCE_ENDED",
  "HAPPINESS_CHANGED", "HAPPINESS_DECAYED", "EXPERIENCE_HAPPINESS_RESOLVED", "EXPERIENCE_ACCESS_PAID",
  "INVITATION_SENT", "INVITATION_ACCEPTED", "INVITATION_DECLINED", "INVITATION_EXPIRED",
  "COMMITMENT_CREATED", "COMMITMENT_REMINDER_SENT", "COMMITMENT_WINDOW_OPENED", "COMMITMENT_KEPT", "COMMITMENT_MISSED",
  "JOB_TEAM_MEMBER_JOINED", "JOB_TEAM_MEMBER_LEFT",
  "ENERGY_CHANGED", "REST_STARTED", "REST_COMPLETED", "DECISION_RECORDED",
  "DEADLINE_SUPPRESSED_FOR_PLATFORM_INCIDENT", "AGENT_RESPONSE_MISSED", "AGENT_RECOVERY_VERIFIED",
]);

export const nonProjectionEventTypes = new Set([
  "AGENT_ACTION_PROCESSED", "RELEVANCE_EVALUATED", "OWNER_FEED_VIEWED",
  "RETURN_SUMMARY_VIEWED", "STORY_DETAIL_VIEWED", "STORY_INTEREST_RATED",
  "AGENT_EVENT_REPLAYED", "AGENT_CONNECTION_TESTED",
  "OPPORTUNITIES_VIEWED", "AGENT_RULES_REQUESTED", "DECISION_CONTEXT_REQUESTED",
]);

// A directional relationship is private to its owner, so only `fromId` projects it.
export const directionalRelationshipEventTypes = new Set([
  "RELATIONSHIP_CREATED", "RELATIONSHIP_CHANGED",
  "RELATIONSHIP_APPRAISAL_RECORDED", "RELATIONSHIP_OBJECTIVE_OUTCOME_RECORDED",
]);

export class DomainError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isNotificationTerminal(status) {
  return ["resolved", "expired", "cancelled"].includes(status);
}

export function createEmptyState() {
  return {
    locations: new Map(), connections: new Map(), characters: new Map(), relationships: new Map(),
    conversations: new Map(), jobs: new Map(), gatherings: new Map(), coPresence: new Map(),
    invitations: new Map(), commitments: new Map(),
    notifications: new Map(), knowledge: new Map(), actionReceipts: new Map(),
    systemBudgets: new Map(), platformIncident: null,
    returnSummaries: new Map(), storyDetailViews: new Set(), storyRatings: new Map(),
    agentCredentials: new Map(), agentEventChannels: new Map(), activeWorldConfigurationVersion: null,
    eventsById: new Map(), itemVersions: new Map(),
    experienceAttendance: new Map(), happinessResolutions: new Map(),
    characterProjectionVersions: new Map(), globalProjectionVersion: 0,
    conversationAppraisals: new Set(),
  };
}

export function conversationAppraisalKey(characterId, conversationId) {
  return `${characterId}:${conversationId}`;
}

// Every catalogable entity an event touched. Feeds the item-version index, which
// answers "what changed since the version this runtime last saw" without the server
// having to remember what it previously delivered to whom.
export function itemsTouchedByEvent(event) {
  const data = event.data ?? {};
  return [...new Set([
    data.id, data.jobId, data.eventId, data.invitationId, data.commitmentId, data.characterId,
    ...(data.workerIds ?? []),
  ].filter((value) => typeof value === "string"))];
}

// Mirrors characterMayReference: the characters whose projection an event advances.
// EVENT_CREATED is handled separately because it is perceivable by every character.
export function projectionCharactersForEvent(event) {
  if (directionalRelationshipEventTypes.has(event.type)) {
    return event.data?.fromId ? [event.data.fromId] : [];
  }
  return [...new Set([
    event.actorCharacterId, event.subjectCharacterId,
    ...(event.data?.participantIds ?? []),
  ].filter(Boolean))];
}

// City grammar policy v1: the ten shared dimensions describe what a place or a
// gathering delivers to a person. The server never learns what it is called.

// Preferences are budgeted: caring is scarce, which is the only reason affinity
// discriminates between one resident and another.
export function normalizePreferences(preferences, grammar) {
  const vector = normalizeProfileVector(preferences, grammar, "preference");
  const total = Object.values(vector).reduce((sum, value) => sum + value, 0);
  if (total !== grammar.preferenceBudget) {
    throw invalid("INVALID_PROFILE_BUDGET",
      `Preference dimensions must sum to exactly ${grammar.preferenceBudget}, received ${total}`);
  }
  return vector;
}

// A profile is not budgeted: an experience that genuinely delivers music, socializing
// and luxury says so without robbing an axis to pay for it. It only has to deliver
// something, because a profile of nothing has no experiential value to measure.
export function normalizeExperienceProfile(profile, grammar) {
  const vector = normalizeProfileVector(profile, grammar, "experience profile");
  if (Object.values(vector).every((value) => value === 0)) {
    throw invalid("EMPTY_EXPERIENCE_PROFILE", "An experience profile must deliver at least one dimension above zero");
  }
  return vector;
}

function normalizeProfileVector(vector, grammar, label) {
  if (!vector || typeof vector !== "object" || Array.isArray(vector)) {
    throw invalid("INVALID_PROFILE", `${label} must be an object of profile dimensions`);
  }
  for (const dimension of Object.keys(vector)) {
    if (!grammar.profileDimensions.includes(dimension)) {
      // Never ignored: an unknown dimension is a version mismatch, not a typo to skip.
      throw invalid("UNKNOWN_PROFILE_DIMENSION", `${dimension} is not a version-${grammar.profileTaxonomyVersion} profile dimension`);
    }
  }
  const result = {};
  for (const dimension of grammar.profileDimensions) {
    const value = Number(vector[dimension] ?? 0);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw invalid("INVALID_PROFILE_VALUE", `${label} ${dimension} must be an integer between 0 and 100`);
    }
    result[dimension] = value;
  }
  return result;
}

// The factors that sum to a resolution's raw delta. The recorded `factors` object also
// carries diagnostics — affinityValue, presenceMinutes, plannedMinutes, coPresentCount,
// the per-person breakdown, the taxonomy version — which explain an evening but are not
// contributions. Averaging those as if they were reports a taxonomy version of 1 as a
// Happiness contribution, so the summed set is named once and read from here.
export const happinessFactorNames = Object.freeze([
  "affinity", "presenceValue", "interaction", "participation", "crowd", "repetition", "variance",
]);

// Tags are derived, never submitted: the vocabulary is the ten dimensions, and a tag
// means "this actually delivers that". Sorted, so a catalog page is deterministic.
export function derivedTags(profile, grammar) {
  if (!profile) return [];
  return grammar.profileDimensions
    .filter((dimension) => (profile[dimension] ?? 0) >= grammar.tagThreshold)
    .sort();
}

export function evenPreferences(grammar) {
  const share = grammar.preferenceBudget / grammar.profileDimensions.length;
  if (!Number.isInteger(share)) throw new Error("Preference budget must divide evenly across the dimensions");
  return Object.fromEntries(grammar.profileDimensions.map((dimension) => [dimension, share]));
}

// The resident's preferences weighted by what the experience actually delivers. A
// gathering that delivers only music is measured purely against how much this
// resident cares about music; one that delivers music and luxury, against both in
// proportion. That normalizes a free profile without constraining it.
export function profileAffinity(preferences, profile, grammar) {
  let weighted = 0;
  let delivered = 0;
  for (const dimension of grammar.profileDimensions) {
    const offers = profile?.[dimension] ?? 0;
    weighted += offers * (preferences?.[dimension] ?? 0);
    delivered += offers;
  }
  return delivered > 0 ? weighted / delivered : 0;
}

// Repetition similarity, deliberately the crudest defensible rule: the dimension an
// experience leads with. Deterministic, needs no threshold, and cannot be gamed by
// relabelling because the dimensions are controlled.
export function dominantDimension(profile, grammar) {
  let best = null;
  let bestValue = -1;
  for (const dimension of grammar.profileDimensions) {
    const value = profile?.[dimension] ?? 0;
    if (value > bestValue) { best = dimension; bestValue = value; }
  }
  return bestValue > 0 ? best : null;
}

// At most two, from the controlled taxonomy. Free text carries the meaning; the topic
// list is the mechanical handle, so an invented topic is rejected rather than ignored.
export function normalizeTopics(topics, grammar) {
  if (topics === undefined || topics === null) return [];
  if (!Array.isArray(topics)) throw invalid("INVALID_TOPICS", "Conversation topics must be an array");
  if (topics.length > 2) throw invalid("TOO_MANY_TOPICS", "A turn may declare at most two topics");
  const normalized = [];
  for (const topic of topics) {
    if (!grammar.profileDimensions.includes(topic)) {
      throw invalid("UNKNOWN_TOPIC", `${topic} is not a version-${grammar.profileTaxonomyVersion} profile dimension`);
    }
    if (!normalized.includes(topic)) normalized.push(topic);
  }
  return normalized;
}

export function appraisalOutcomeKey(detail) {
  if (!detail?.appraisal) return "unappraised";
  if (detail.appraisal === "neutral") return "neutral";
  return `${detail.interactionKind}:${detail.appraisal}`;
}

// Point 9: quality from declared interest, not from a classifier. With no declared
// topic the exchange is neutral; a topic this resident cares about lands better.
export function topicFitFor(preferences, topics, policy) {
  if (!topics || topics.length === 0) return policy.topicFitNeutral;
  const average = topics.reduce((sum, topic) => sum + (preferences?.[topic] ?? 0), 0) / topics.length;
  return policy.topicFitNeutral + ((average - 50) / 50) * policy.topicFitRange;
}

export function experienceAttendanceKey(eventId, characterId) {
  return `${eventId}:${characterId}`;
}

export function round2(value) {
  const rounded = Math.round(value * 100) / 100;
  // Normalize negative zero: a recorded factor of -0 reads as a penalty that was not
  // applied, and it serializes into the event log that way too.
  return rounded === 0 ? 0 : rounded;
}

export function relationshipKey(fromId, toId) {
  return `${fromId}->${toId}`;
}

export function coPresenceKey(firstCharacterId, secondCharacterId, locationId) {
  return `${[firstCharacterId, secondCharacterId].sort().join("<->")}@${locationId}`;
}

export function timeWindowsOverlap(firstStartsAt, firstEndsAt, secondStartsAt, secondEndsAt) {
  return new Date(firstStartsAt) < new Date(secondEndsAt) && new Date(secondStartsAt) < new Date(firstEndsAt);
}

export function normalizeRelationship(relationship, config) {
  const affinity = Number(relationship.affinity ?? 0);
  const trust = Number(relationship.trust ?? 0);
  const tension = Number(relationship.tension ?? 0);
  if (![affinity, trust, tension].every(Number.isFinite)) throw invalid("INVALID_RELATIONSHIP", "Relationship dimensions must be numbers");
  return {
    affinity: clamp(affinity, config.minimum, config.maximum),
    trust: clamp(trust, config.minimum, config.maximum),
    tension: clamp(tension, config.tensionMinimum, config.tensionMaximum),
  };
}

export function relationshipStrength(relationship) {
  if (!relationship) return 0;
  return Math.max(Math.abs(relationship.affinity), Math.abs(relationship.trust), relationship.tension);
}

export function normalizeSkills(skills) {
  const result = {};
  for (const skill of ["social", "business", "creativity", "technical"]) {
    const value = Number(skills?.[skill] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw invalid("INVALID_SKILL", `${skill} must be between 0 and 100`);
    result[skill] = value;
  }
  return result;
}

export function normalizeGoal(goal, { id = goal.id, className }) {
  requiredId(id, "goal id");
  requiredId(goal.type, "goal type");
  if (!['low', 'medium', 'high'].includes(goal.priority ?? "medium")) throw invalid("INVALID_GOAL_PRIORITY", "Goal priority must be low, medium, or high");
  return {
    id,
    goalClass: className,
    type: goal.type,
    targetId: goal.targetId ? String(goal.targetId).slice(0, 100) : null,
    priority: goal.priority ?? "medium",
    guidance: String(goal.guidance ?? "").slice(0, 500),
    expiresAt: goal.expiresAt ?? null,
    sourceEventId: goal.sourceEventId ?? null,
    status: "active",
  };
}

export function scoreGoalMatch(goal, event) {
  let matchType = null;
  const targetCandidates = new Set([
    event.actorCharacterId,
    event.subjectCharacterId,
    event.data.characterId,
    event.data.targetId,
    event.data.locationId,
    event.data.eventId,
    event.data.jobId,
  ].filter(Boolean));
  if (goal.targetId && targetCandidates.has(goal.targetId)) matchType = "exact";
  else if (goal.type === "find_work" && event.type.startsWith("JOB_")) matchType = goal.targetId ? null : "contextual";
  else if (["strengthen_relationship", "avoid_character", "resolve_conflict"].includes(goal.type)
    && goal.targetId && [event.actorCharacterId, event.subjectCharacterId].includes(goal.targetId)) matchType = "exact";
  else if (goal.type === "attend_event" && event.data.eventId === goal.targetId) matchType = "exact";
  else if (goal.type === "visit_location" && event.data.locationId === goal.targetId) matchType = "exact";
  if (!matchType) return null;
  const base = goal.goalClass === "primary"
    ? matchType === "exact" ? 30 : 20
    : matchType === "exact" ? 20 : 10;
  const priority = goal.priority === "high" ? 10 : goal.priority === "medium" ? 5 : 0;
  const cap = goal.goalClass === "primary" ? 40 : 30;
  return {
    goalId: goal.id,
    goalClass: goal.goalClass,
    goalType: goal.type,
    matchType,
    priority: goal.priority,
    contribution: Math.min(cap, base + priority),
  };
}

export function goalMatchesEvidence(goal, characterId, event) {
  if (goal.type === "visit_location") return event.type === "CHARACTER_ARRIVED"
    && event.data.characterId === characterId && event.data.locationId === goal.targetId;
  if (goal.type === "attend_event") return event.type === "EVENT_ATTENDANCE_STARTED"
    && event.data.characterId === characterId && event.data.eventId === goal.targetId;
  if (goal.type === "find_work") return ["JOB_ACCEPTED", "JOB_COMPLETED"].includes(event.type)
    && event.data.workerId === characterId && (!goal.targetId || event.data.locationId === goal.targetId);
  if (goal.type === "strengthen_relationship") return event.type === "RELATIONSHIP_CHANGED"
    && event.data.fromId === characterId && event.data.toId === goal.targetId
    && ["affinity", "trust"].includes(event.data.dimension) && event.data.delta > 0;
  if (goal.type === "resolve_conflict") return event.type === "RELATIONSHIP_CHANGED"
    && event.data.fromId === characterId && event.data.toId === goal.targetId
    && event.data.dimension === "tension" && event.data.delta < 0;
  return false;
}

export function normalizeFact(fact) {
  if (!fact || typeof fact !== "object") throw invalid("INVALID_FACT", "Shared fact must be an object");
  requiredId(fact.id, "fact id");
  requiredText(fact.claim, "fact claim", 500);
  const perceivedReliability = fact.perceivedReliability ?? "unknown";
  if (!["unknown", "low", "medium", "high"].includes(perceivedReliability)) {
    throw invalid("INVALID_FACT_RELIABILITY", "Perceived reliability must be unknown, low, medium, or high");
  }
  return {
    id: fact.id, claim: fact.claim,
    subjectId: fact.subjectId ? String(fact.subjectId).slice(0, 100) : null,
    perceivedReliability,
  };
}

export function publicCharacter(character) {
  return structuredClone({
    id: character.id, name: character.name, personality: character.personality, goal: character.goal,
    primaryGoal: character.primaryGoal, secondaryGoals: character.secondaryGoals,
    locationId: character.locationId, activity: character.activity, energy: character.energy,
    credits: character.credits, skills: character.skills, reputation: character.reputation, score: character.score,
    agentAvailability: character.agentAvailability, consecutiveMissedResponses: character.consecutiveMissedResponses,
    // AIT-1501: a character sees its own Happiness and its own preference vector, and
    // never another character's. Credits answer whether it can afford something,
    // Energy whether it can sustain it, Happiness whether any of it is worth living.
    happiness: character.happiness,
    livedHappiness: character.livedHappiness ?? 0,
    preferences: character.preferences,
  });
}

export function conversationObservation(conversation, config) {
  const copy = structuredClone(conversation);
  const turnsRemaining = Math.max(0, config.maximumTurns - copy.messages.length);
  return {
    ...copy,
    maximumTurns: config.maximumTurns,
    turnsRemaining,
    closingRecommended: turnsRemaining <= config.closingTurns,
  };
}

export function publicJob(job, energyCost = null) {
  return structuredClone({
    id: job.id, creatorId: job.creatorId, workerId: job.workerId, workerIds: job.workerIds,
    teamSize: job.teamSize, openTeamSlots: Math.max(0, job.teamSize - job.workerIds.length),
    requirementsMode: job.requirementsMode, title: job.title,
    locationId: job.locationId, durationGameMinutes: job.durationGameMinutes,
    compensation: job.compensation, requirements: job.requirements, status: job.status,
    visibility: job.visibility ?? "public",
    publishedAt: job.publishedAt,
    scheduledStartAt: job.scheduledStartAt, startGraceUntil: job.startGraceUntil,
    offerExpiresAt: job.offerExpiresAt,
    availableFrom: job.availableFrom, availableUntil: job.availableUntil,
    fundingSourceType: job.fundingSourceType, fundingSourceId: job.fundingSourceId,
    reservation: job.reservation, terminalCause: job.terminalCause ?? null,
    ...(energyCost === null ? {} : { energyCost }),
  });
}

export function ownerFeedCategory(type) {
  if (["MOVEMENT_STARTED", "CHARACTER_ARRIVED", "REST_STARTED", "REST_COMPLETED", "EVENT_ATTENDANCE_STARTED", "EVENT_ATTENDANCE_ENDED"].includes(type)) return "action";
  if (["CO_PRESENCE_STARTED", "CO_PRESENCE_ENDED", "CONVERSATION_STARTED", "CONVERSATION_MESSAGE_SENT", "CONVERSATION_ENDED"].includes(type)) return "encounter";
  if (["RELATIONSHIP_CREATED", "RELATIONSHIP_CHANGED", "KNOWLEDGE_LEARNED", "SECONDARY_GOAL_ADOPTED", "SECONDARY_GOAL_COMPLETED"].includes(type)) return "consequence";
  if (type.startsWith("JOB_") || type === "EVENT_CREATED") return "opportunity";
  if (type.includes("EXPIRED") || type.includes("TIMED_OUT") || type === "SILENCE_RESOLVED" || type === "AGENT_RESPONSE_MISSED") return "agent_timeout";
  if (type === "DECISION_RECORDED") return "decision";
  return "world";
}

export function ownerFeedDetails(event) {
  const data = event.data;
  if (event.type === "RELATIONSHIP_CHANGED") return {
    counterpartId: data.toId, dimension: data.dimension, previous: data.previous,
    delta: data.delta, value: data.value, rule: data.rule, sourceType: data.sourceType,
    relationshipRuleVersion: data.relationshipRuleVersion,
  };
  if (event.type === "CONVERSATION_ENDED") return {
    conversationId: data.conversationId, reason: data.reason, turnCount: data.turnCount,
    durationGameMinutes: data.durationGameMinutes, producedFactIds: data.producedFactIds,
  };
  if (event.type === "KNOWLEDGE_LEARNED") return {
    fact: data.fact, sourceCharacterId: data.sourceCharacterId, messageId: data.messageId,
  };
  if (event.type.startsWith("JOB_")) return {
    jobId: data.jobId ?? data.id, title: data.title, terminalCause: data.terminalCause,
    compensation: data.compensation,
  };
  if (event.type.startsWith("SECONDARY_GOAL_")) return {
    goalId: data.goalId ?? data.goal?.id, goal: data.goal ?? null,
  };
  if (event.type === "DECISION_RECORDED") return { declaredDecision: data.summary };
  // An evening is only explainable to the owner if the factors reach them. The feed is
  // where "he expected a great night and it went badly" stops being a claim.
  if (event.type === "EXPERIENCE_HAPPINESS_RESOLVED") return {
    eventId: data.eventId, locationId: data.locationId, cause: data.cause,
    rawDelta: data.rawDelta, factors: data.factors,
    dominantDimension: data.dominantDimension,
    happinessPolicyVersion: data.happinessPolicyVersion,
  };
  if (event.type === "HAPPINESS_CHANGED") return {
    reason: data.reason, previous: data.previous, value: data.value,
    rawDelta: data.rawDelta, appliedDelta: data.appliedDelta,
    lived: data.lived, livedDelta: data.livedDelta,
    happinessPolicyVersion: data.happinessPolicyVersion,
  };
  if (event.type === "HAPPINESS_DECAYED") return {
    worldDays: data.worldDays, previous: data.previous, value: data.value,
    delta: data.delta, floor: data.floor, lived: data.lived,
    happinessPolicyVersion: data.happinessPolicyVersion,
  };
  if (event.type === "EXPERIENCE_ACCESS_PAID") return {
    eventId: data.eventId, price: data.price,
    experienceCommercePolicyVersion: data.experienceCommercePolicyVersion,
  };
  return {};
}

export function summaryPriority(type) {
  if (type === "RELATIONSHIP_CHANGED") return 100;
  // A resolved evening ranks with a completed job: it is the other thing a resident
  // spent their day on, and the one an owner returns to read about.
  if (type === "EXPERIENCE_HAPPINESS_RESOLVED") return 92;
  if (["JOB_FAILED", "JOB_COMPLETED", "SECONDARY_GOAL_COMPLETED", "SECONDARY_GOAL_ADOPTED"].includes(type)) return 90;
  if (["AGENT_REACTION_TIMED_OUT", "CONVERSATION_TURN_EXPIRED", "SILENCE_RESOLVED"].includes(type)) return 85;
  if (type === "DECISION_RECORDED") return 80;
  if (type === "KNOWLEDGE_LEARNED") return 75;
  if (type === "CONVERSATION_ENDED") return 70;
  if (["CHARACTER_ARRIVED", "CONVERSATION_STARTED"].includes(type)) return 50;
  return 0;
}

export function encodeOwnerCursor(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function decodeOwnerCursor(cursor, secret) {
  try {
    const [encoded, suppliedSignature, extra] = String(cursor).split(".");
    if (!encoded || !suppliedSignature || extra) throw new Error("malformed");
    const expected = createHmac("sha256", secret).update(encoded).digest();
    const supplied = Buffer.from(suppliedSignature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("signature");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") throw new Error("payload");
    return payload;
  } catch {
    throw new DomainError("INVALID_CURSOR", "Owner feed cursor is invalid", 400);
  }
}

export function metric(numerator, denominator) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

export function delaySummary(values) {
  if (values.length === 0) return { sampleCount: 0, averageWorldMilliseconds: null, maximumWorldMilliseconds: null };
  return {
    sampleCount: values.length,
    averageWorldMilliseconds: values.reduce((sum, value) => sum + value, 0) / values.length,
    maximumWorldMilliseconds: Math.max(...values),
  };
}

export function buildDescendantIndex(events) {
  const directChildren = new Map();
  for (const event of events) {
    for (const causeId of event.causedByEventIds) {
      if (!directChildren.has(causeId)) directChildren.set(causeId, new Set());
      directChildren.get(causeId).add(event.id);
    }
  }
  const result = new Map();
  for (const event of events) {
    const descendants = new Set();
    const queue = [...(directChildren.get(event.id) ?? [])];
    while (queue.length > 0) {
      const eventId = queue.shift();
      if (descendants.has(eventId)) continue;
      descendants.add(eventId);
      queue.push(...(directChildren.get(eventId) ?? []));
    }
    result.set(event.id, descendants);
  }
  return result;
}

export function projectStoryCandidates(events, descendants) {
  const roots = events.filter((event) => ["CO_PRESENCE_STARTED", "CHARACTER_ARRIVED", "CONVERSATION_STARTED"].includes(event.type));
  const consequenceTypes = new Set([
    "RELATIONSHIP_CHANGED", "KNOWLEDGE_LEARNED", "SECONDARY_GOAL_ADOPTED",
    "JOB_ACCEPTED", "JOB_COMPLETED", "JOB_CANCELLED", "JOB_FAILED",
  ]);
  const consequences = events.filter((event) => consequenceTypes.has(event.type));
  const candidates = [];
  for (const root of roots) {
    const depth = new Map([[root.id, 0]]);
    const reachableEvents = events
      .filter((event) => event.sequence > root.sequence && descendants.get(root.id)?.has(event.id))
      .sort((a, b) => a.sequence - b.sequence);
    for (const event of reachableEvents) {
      const parentDepths = event.causedByEventIds.map((id) => depth.get(id)).filter(Number.isFinite);
      if (parentDepths.length > 0) depth.set(event.id, Math.max(...parentDepths) + 1);
    }
    for (const terminal of consequences) {
      const causalEdges = depth.get(terminal.id);
      if (!Number.isFinite(causalEdges) || causalEdges < 3) continue;
      if (new Date(terminal.worldTime) > new Date(new Date(root.worldTime).getTime() + 24 * 60 * 60_000)) continue;
      const pathEvents = [root, ...reachableEvents.filter((event) => event.sequence <= terminal.sequence && depth.has(event.id))];
      const characterIds = [...new Set(pathEvents.flatMap(charactersForEvent))];
      if (characterIds.length < 2) continue;
      candidates.push({
        id: `${root.id}:${terminal.id}:v1`,
        rootEventId: root.id,
        terminalConsequenceEventId: terminal.id,
        characterIds,
        causalEdges,
        metricDefinitionVersion: 1,
      });
    }
  }
  return candidates;
}

export function collectActiveCharacterDays(events) {
  const activeTypes = new Set([
    "MOVEMENT_STARTED", "CONVERSATION_STARTED", "CONVERSATION_MESSAGE_SENT",
    "JOB_ACCEPTED", "JOB_STARTED", "JOB_COMPLETED", "EVENT_ATTENDANCE_STARTED",
    "REST_STARTED", "SECONDARY_GOAL_ADOPTED", "DECISION_RECORDED",
  ]);
  const days = new Set();
  for (const event of events.filter((item) => activeTypes.has(item.type))) {
    for (const characterId of charactersForEvent(event)) days.add(`${characterId}:${event.worldTime.slice(0, 10)}`);
  }
  return days;
}

export function charactersForEvent(event) {
  return [...new Set([
    event.actorCharacterId, event.subjectCharacterId,
    ...(event.data.participantIds ?? []), event.data.characterId,
    event.data.fromId, event.data.toId, event.data.workerId, event.data.creatorId,
  ].filter(Boolean))];
}

export function requiredId(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) {
    throw invalid("INVALID_ID", `${label} is invalid`);
  }
}

export function requiredText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw invalid("INVALID_TEXT", `${label} must contain 1-${maximum} characters`);
  }
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function addMilliseconds(value, milliseconds) {
  return new Date(new Date(value).getTime() + milliseconds).toISOString();
}

export function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function invalid(code, message) {
  return new DomainError(code, message, 422);
}

export function conflict(code, message) {
  return new DomainError(code, message, 409);
}

export function forbidden(code, message) {
  return new DomainError(code, message, 403);
}

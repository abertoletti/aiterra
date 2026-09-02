// The owner-facing projection: the feed, return summaries, story details,
// ratings, and product metrics. These read history and report on it, and each
// takes the world rather than living on it, so the reporting surface can grow
// without enlarging the aggregate that owns the rules.
import { createHash } from "node:crypto";
import {
  DomainError, buildDescendantIndex, collectActiveCharacterDays, conflict, decodeOwnerCursor,
  delaySummary, encodeOwnerCursor, invalid, metric, ownerFeedCategory, ownerFeedDetails,
  happinessFactorNames, ownerFeedTypes, projectStoryCandidates, requiredId, round2,
  summaryPriority,
} from "./world-support.js";

export function getOwnerFeed(world, { ownerId, characterId, cursor = null, limit = world.config.ownerFeed.defaultPageSize, cursorSecret, realNow = new Date() }) {
  requiredId(ownerId, "owner id");
  world.requireCharacter(characterId);
  if (typeof cursorSecret !== "string" || cursorSecret.length < 16) throw new Error("Owner feed cursor secret must contain at least 16 characters");
  const requestedLimit = Number(limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > world.config.ownerFeed.maximumPageSize) {
    throw invalid("INVALID_PAGE_SIZE", `Feed page size must be between 1 and ${world.config.ownerFeed.maximumPageSize}`);
}
  const now = new Date(realNow);
  if (Number.isNaN(now.getTime())) throw invalid("INVALID_TIME", "Feed request time is invalid");
  const visibleEvents = world.history.filter((event) => world.characterMayReference(characterId, event));
  let pagination;
  if (cursor) {
    pagination = decodeOwnerCursor(cursor, cursorSecret);
    if (pagination.ownerId !== ownerId || pagination.characterId !== characterId) {
      throw new DomainError("CURSOR_SCOPE_MISMATCH", "Cursor is not valid for this owner and character scope", 403);
    }
    if (pagination.projectionVersion !== world.config.ownerFeed.authorizationProjectionVersion
      || pagination.paginationVersion !== world.config.ownerFeed.paginationContractVersion) {
      throw new DomainError("CURSOR_EXPIRED", "Cursor projection is no longer valid", 410);
    }
    if (new Date(pagination.expiresAt) <= now) throw new DomainError("CURSOR_EXPIRED", "Cursor has expired", 410);
  } else {
    const snapshotThroughSequence = visibleEvents.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
    pagination = {
      ownerId, characterId, snapshotThroughSequence,
      beforeSequence: snapshotThroughSequence + 1,
      projectionVersion: world.config.ownerFeed.authorizationProjectionVersion,
      paginationVersion: world.config.ownerFeed.paginationContractVersion,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + world.config.ownerFeed.cursorTtlRealHours * 3_600_000).toISOString(),
    };
}
  const eligible = visibleEvents
    .filter((event) => ownerFeedTypes.has(event.type))
    .filter((event) => event.sequence <= pagination.snapshotThroughSequence && event.sequence < pagination.beforeSequence)
    .sort((a, b) => b.sequence - a.sequence);
  const page = eligible.slice(0, requestedLimit);
  const hasMore = eligible.length > page.length;
  const nextCursor = hasMore ? encodeOwnerCursor({
    ...pagination,
    beforeSequence: page.at(-1).sequence,
  }, cursorSecret) : null;
  return {
    items: page.map((event) => world.ownerFeedItem(event, characterId)),
    nextCursor,
    hasMore,
    snapshotThroughSequence: pagination.snapshotThroughSequence,
  };
}


export function ownerFeedItem(world, event, characterId) {
  const timelineText = world.getTimeline({ characterId }).find((item) => item.id === event.id)?.text
    ?? event.type.toLowerCase().replaceAll("_", " ");
  const peopleIds = [...new Set([
    event.actorCharacterId, event.subjectCharacterId,
    ...(event.data.participantIds ?? []), event.data.fromId, event.data.toId,
    event.data.workerId, event.data.creatorId,
  ].filter(Boolean))];
  return {
    id: event.id,
    worldSequence: event.sequence,
    worldTime: event.worldTime,
    type: event.type,
    category: ownerFeedCategory(event.type),
    summary: timelineText,
    locationId: event.data.locationId ?? null,
    peopleIds,
    causedByEventIds: [...event.causedByEventIds],
    details: ownerFeedDetails(event),
  };
}


export function createReturnSummary(world, { ownerId, characterId, sinceWorldTime, throughWorldTime = world.clock.now() }) {
  requiredId(ownerId, "owner id");
  world.requireCharacter(characterId);
  const since = new Date(sinceWorldTime);
  const through = new Date(throughWorldTime);
  if (Number.isNaN(since.getTime()) || Number.isNaN(through.getTime()) || since > through) {
    throw invalid("INVALID_SUMMARY_INTERVAL", "Return summary interval is invalid");
}
  const summaryId = createHash("sha256")
    .update(`${ownerId}|${characterId}|${since.toISOString()}|${through.toISOString()}`)
    .digest("hex").slice(0, 24);
  const existing = world.state.returnSummaries.get(summaryId);
  if (existing) return structuredClone(existing);
  const events = world.history
    .filter((event) => new Date(event.worldTime) >= since && new Date(event.worldTime) <= through)
    .filter((event) => world.characterMayReference(characterId, event) && ownerFeedTypes.has(event.type));
  const highlights = events
    .map((event) => ({ event, priority: summaryPriority(event.type) }))
    .filter((entry) => entry.priority > 0)
    .sort((a, b) => b.priority - a.priority || b.event.sequence - a.event.sequence)
    .slice(0, world.config.ownerFeed.maximumSummaryHighlights)
    .map(({ event }) => ({
      detailEventId: event.id,
      sourceEventIds: [...new Set([event.id, ...event.causedByEventIds])],
      ...world.ownerFeedItem(event, characterId),
    }));
  const summary = {
    id: summaryId, ownerId, characterId,
    interval: { fromWorldTime: since.toISOString(), throughWorldTime: through.toISOString() },
    message: highlights.length > 0
      ? `${highlights.length} factual development${highlights.length === 1 ? "" : "s"} occurred in this interval.`
      : "No relevant developments occurred in this interval.",
    highlights,
    generatedAtReal: new Date().toISOString(),
  };
  world.record("RETURN_SUMMARY_AVAILABLE", {
    actorCharacterId: characterId,
    data: { summary },
  });
  return structuredClone(summary);
}


export function viewReturnSummary(world, ownerId, characterId, summaryId) {
  const summary = world.state.returnSummaries.get(summaryId);
  if (!summary || summary.ownerId !== ownerId || summary.characterId !== characterId) {
    throw new DomainError("SUMMARY_NOT_FOUND", "Return summary not found", 404);
}
  world.record("RETURN_SUMMARY_VIEWED", {
    actorCharacterId: characterId,
    data: { ownerId, characterId, summaryId },
  });
  return structuredClone(summary);
}


export function viewStoryDetail(world, ownerId, characterId, eventId) {
  const event = world.eventById(eventId);
  if (!event || !world.characterMayReference(characterId, event)) throw new DomainError("STORY_DETAIL_NOT_FOUND", "Story detail not found", 404);
  world.record("STORY_DETAIL_VIEWED", {
    actorCharacterId: characterId,
    causedByEventIds: [event.id],
    data: { ownerId, characterId, detailEventId: event.id, ratingOffered: true },
  });
  return world.ownerFeedItem(event, characterId);
}


export function rateStory(world, ownerId, characterId, eventId, rating) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw invalid("INVALID_STORY_RATING", "Story rating must be an integer from 1 to 5");
  const viewKey = `${ownerId}:${characterId}:${eventId}`;
  if (!world.state.storyDetailViews.has(viewKey)) throw conflict("STORY_DETAIL_NOT_VIEWED", "Story detail must be viewed before rating");
  if (world.state.storyRatings.has(viewKey)) throw conflict("STORY_ALREADY_RATED", "This story detail was already rated");
  return world.record("STORY_INTEREST_RATED", {
    actorCharacterId: characterId,
    causedByEventIds: [eventId],
    data: { ownerId, characterId, detailEventId: eventId, rating },
  });
}


export function getProductMetrics(world, { fromWorldTime = null, throughWorldTime = null, environment = "development", isTest = false, testRunId = null } = {}) {
  const from = fromWorldTime ? new Date(fromWorldTime) : null;
  const through = throughWorldTime ? new Date(throughWorldTime) : null;
  if ((from && Number.isNaN(from.getTime())) || (through && Number.isNaN(through.getTime())) || (from && through && from > through)) {
    throw invalid("INVALID_METRIC_INTERVAL", "Metric interval is invalid");
}
  const events = world.history.filter((event) => (!from || new Date(event.worldTime) >= from) && (!through || new Date(event.worldTime) <= through));
  const eventById = new Map(world.history.map((event) => [event.id, event]));
  const suppressedNotificationIds = new Set(world.history
    .filter((event) => event.type === "DEADLINE_SUPPRESSED_FOR_PLATFORM_INCIDENT")
    .map((event) => event.data.notificationEventId));
  const deliveredExpected = events.filter((event) => event.type === "AGENT_NOTIFICATION_DELIVERED")
    .filter((event) => !suppressedNotificationIds.has(event.data.notificationEventId));
  const deliveredConversation = deliveredExpected.filter((event) =>
    world.state.notifications.get(event.data.notificationEventId)?.requestKind === "conversation_response");
  const repliedNotificationIds = new Set(events
    .filter((event) => event.type === "CONVERSATION_RESPONSE_RECORDED" && event.data.outcome === "message")
    .filter((event) => {
      const notification = world.state.notifications.get(event.data.notificationEventId);
      if (!notification) return false;
      return new Date(event.worldTime) <= new Date(notification.respondByWorldTime)
        && new Date(event.recordedAt) <= new Date(notification.respondByRealTime);
    })
    .map((event) => event.data.notificationEventId));

  const coPresenceEpisodes = events.filter((event) => event.type === "CO_PRESENCE_STARTED" && event.data.interactionEligible);
  const interactions = events.filter((event) => event.type === "CONVERSATION_STARTED");
  const terminalByConversation = new Map(events.filter((event) => event.type === "CONVERSATION_ENDED")
    .map((event) => [event.data.conversationId, event]));
  const terminalInteractions = interactions.filter((event) => terminalByConversation.has(event.data.conversationId));
  const successfulConversationReasons = new Set(["participant_ended", "turn_limit"]);
  const successfulInteractions = terminalInteractions.filter((event) =>
    successfulConversationReasons.has(terminalByConversation.get(event.data.conversationId).data.reason));
  const consequenceTypes = new Set([
    "RELATIONSHIP_CHANGED", "KNOWLEDGE_LEARNED", "SECONDARY_GOAL_ADOPTED",
    "JOB_ACCEPTED", "JOB_COMPLETED", "JOB_CANCELLED", "JOB_FAILED",
  ]);
  const descendants = buildDescendantIndex(world.history);
  const interactionsWithConsequence = interactions.filter((root) => {
    const limit = new Date(root.worldTime).getTime() + 60 * 60_000;
    return [...(descendants.get(root.id) ?? [])].some((eventId) => {
      const event = eventById.get(eventId);
      return consequenceTypes.has(event.type) && new Date(event.worldTime).getTime() <= limit;
    });
  });
  const timeoutEvents = events.filter((event) => ["AGENT_REACTION_TIMED_OUT", "CONVERSATION_TURN_EXPIRED"].includes(event.type))
    .filter((event) => !suppressedNotificationIds.has(event.data.notificationEventId));
  const storyCandidates = projectStoryCandidates(world.history, descendants)
    .filter((candidate) => {
      const root = eventById.get(candidate.rootEventId);
      return (!from || new Date(root.worldTime) >= from) && (!through || new Date(root.worldTime) <= through);
    });
  const activeCharacterDays = collectActiveCharacterDays(events);

  const summariesAvailable = new Set(events.filter((event) => event.type === "RETURN_SUMMARY_AVAILABLE").map((event) => event.data.summary.id));
  const summariesViewed = new Set(events.filter((event) => event.type === "RETURN_SUMMARY_VIEWED").map((event) => event.data.summaryId));
  const detailViews = new Set(events.filter((event) => event.type === "STORY_DETAIL_VIEWED")
    .map((event) => `${event.data.ownerId}:${event.data.characterId}:${event.data.detailEventId}`));
  const ratings = events.filter((event) => event.type === "STORY_INTEREST_RATED");
  const ratingKeys = new Set(ratings.map((event) => `${event.data.ownerId}:${event.data.characterId}:${event.data.detailEventId}`));
  const returningOwners = new Set();
  for (const available of events.filter((event) => event.type === "RETURN_SUMMARY_AVAILABLE")) {
    const viewed = events.find((event) => event.type === "RETURN_SUMMARY_VIEWED"
      && event.data.summaryId === available.data.summary.id
      && new Date(event.recordedAt).getTime() <= new Date(available.recordedAt).getTime() + 24 * 3_600_000);
    if (viewed) returningOwners.add(available.data.summary.ownerId);
}
  const eligibleOwners = new Set(events.filter((event) => event.type === "RETURN_SUMMARY_AVAILABLE").map((event) => event.data.summary.ownerId));
  // Experience and Happiness. Nothing here can be calibrated by argument: the novelty
  // reward and the interaction damping both govern exploration, so they need a run that
  // actually recorded what residents chose and what it was worth to them.
  const attendanceStarts = events.filter((event) => event.type === "EVENT_ATTENDANCE_STARTED");
  const resolutions = events.filter((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED");
  const expectationDeclarations = events.filter((event) => event.type === "EXPERIENCE_EXPECTATION_DECLARED");
  const expectedVsRealized = resolutions.filter((event) =>
    Number.isFinite(event.data.expectedHappiness) && Number.isFinite(event.data.rawDelta));
  const expectationErrors = expectedVsRealized.map((event) => event.data.rawDelta - event.data.expectedHappiness);
  const accessPayments = events.filter((event) => event.type === "EXPERIENCE_ACCESS_PAID");
  const decays = events.filter((event) => event.type === "HAPPINESS_DECAYED");
  const workCosts = events.filter((event) => event.type === "HAPPINESS_CHANGED" && event.data.reason === "work_completed");
  const deltas = resolutions.map((event) => event.data.rawDelta);
  const distinctVenuesPerCharacter = new Map();
  for (const event of resolutions) {
    const seen = distinctVenuesPerCharacter.get(event.data.characterId) ?? new Set();
    seen.add(event.data.locationId);
    distinctVenuesPerCharacter.set(event.data.characterId, seen);
  }
  const factorTotals = Object.fromEntries(happinessFactorNames.map((factor) => [factor, 0]));
  for (const event of resolutions) {
    for (const factor of happinessFactorNames) {
      const value = event.data.factors?.[factor];
      if (typeof value === "number") factorTotals[factor] += value;
    }
  }
  const experiences = {
    attendances: attendanceStarts.length,
    reEntries: attendanceStarts.filter((event) => event.data.reEntry).length,
    resolutions: resolutions.length,
    positiveResolutionRate: metric(deltas.filter((delta) => delta > 0).length, deltas.length),
    negativeResolutionRate: metric(deltas.filter((delta) => delta < 0).length, deltas.length),
    meanRealizedDelta: deltas.length ? round2(deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length) : null,
    // Mean contribution of each factor, which is what says whether a factor is doing
    // any work at all or is dead weight in the formula.
    meanFactorContribution: Object.fromEntries(Object.entries(factorTotals)
      .map(([factor, total]) => [factor, round2(total / Math.max(1, resolutions.length))])
      .sort(([left], [right]) => left.localeCompare(right))),
    expectedVsRealized: {
      declarations: expectationDeclarations.length,
      resolvedComparisons: expectedVsRealized.length,
      declarationRate: metric(
        expectationDeclarations.length,
        attendanceStarts.filter((event) => !event.data.reEntry).length,
      ),
      meanExpectedHappiness: expectedVsRealized.length
        ? round2(expectedVsRealized.reduce((sum, event) => sum + event.data.expectedHappiness, 0) / expectedVsRealized.length)
        : null,
      meanRealizedHappiness: expectedVsRealized.length
        ? round2(expectedVsRealized.reduce((sum, event) => sum + event.data.rawDelta, 0) / expectedVsRealized.length)
        : null,
      meanError: expectationErrors.length
        ? round2(expectationErrors.reduce((sum, value) => sum + value, 0) / expectationErrors.length)
        : null,
      meanAbsoluteError: expectationErrors.length
        ? round2(expectationErrors.reduce((sum, value) => sum + Math.abs(value), 0) / expectationErrors.length)
        : null,
    },
    repeatedVenueResolutions: resolutions.filter((event) => (event.data.factors?.repetition ?? 0) < 0).length,
    distinctVenuesPerAttendingCharacter: distinctVenuesPerCharacter.size
      ? round2([...distinctVenuesPerCharacter.values()].reduce((sum, seen) => sum + seen.size, 0)
        / distinctVenuesPerCharacter.size)
      : null,
    paidAttendances: accessPayments.length,
    creditsSpentOnAccess: accessPayments.reduce((sum, event) => sum + event.data.price, 0),
    happinessDecayEvents: decays.length,
    workHappinessCosts: workCosts.length,
    happinessByCharacter: [...world.state.characters.values()]
      .map((character) => ({
        characterId: character.id,
        happiness: character.happiness,
        livedHappiness: character.livedHappiness ?? 0,
      }))
      .sort((left, right) => left.characterId.localeCompare(right.characterId)),
  };

  const contextTransitions = events.flatMap((event) => (event.data?.contextLifecycle ?? [])
    .map((transition) => ({ event, transition })));
  const selectedContextTransitions = contextTransitions.filter(({ transition }) => transition.kind === "selected");
  const engagedSelectionIds = new Set(contextTransitions
    .filter(({ transition }) => transition.kind === "engaged")
    .map(({ transition }) => transition.selectionId));
  const invalidations = contextTransitions.filter(({ transition }) => transition.kind === "invalidated");
  const invalidationsByCause = Object.fromEntries([...new Set(invalidations.map(({ transition }) => transition.code))]
    .sort().map((code) => [code, invalidations.filter(({ transition }) => transition.code === code).length]));
  const contextRequests = events.filter((event) => event.type === "DECISION_CONTEXT_REQUESTED");
  const correlatedActions = events.filter((event) => event.type === "AGENT_ACTION_PROCESSED"
    && event.data.decisionCycleId);
  const staleRejections = events.filter((event) => event.type === "CONTEXT_STALE_ACTION_REJECTED");
  const selectedContext = {
    selections: selectedContextTransitions.length,
    releases: contextTransitions.filter(({ transition }) => transition.kind === "released").length,
    refreshes: contextRequests.length,
    catalogBytesRequested: contextRequests.reduce((sum, event) => sum + (event.data.bytes ?? 0), 0),
    retainedSnapshotBytes: selectedContextTransitions.reduce((sum, { transition }) =>
      sum + JSON.stringify(transition.selection?.snapshot ?? {}).length, 0),
    avoidedRepeatedCatalogBytes: events.filter((event) => event.type === "AGENT_ACTION_PROCESSED")
      .reduce((sum, event) => sum + (event.data.avoidedRepeatedCatalogBytes ?? 0), 0),
    selectionToFirstEngagementRate: metric(
      selectedContextTransitions.filter(({ transition }) => transition.selection?.status === "engaged"
        || engagedSelectionIds.has(transition.selection?.selectionId)).length,
      selectedContextTransitions.length,
    ),
    invalidationsByCause,
    postDisclosureRejectionRate: metric(staleRejections.length, correlatedActions.length),
  };

  const dimensions = {
    metricDefinitionVersion: world.config.metrics.definitionVersion,
    environment,
    isTest: Boolean(isTest),
    testRunId,
    worldConfigurationVersion: world.state.activeWorldConfigurationVersion ?? world.config.metrics.worldConfigurationVersion,
    relationshipPolicyVersion: world.config.relationship.policyVersion,
    timingPolicyVersion: world.config.timing.policyVersion,
    goalsPolicyVersion: world.config.goals.policyVersion,
    escrowPolicyVersion: world.config.jobs.escrowPolicyVersion,
    buildingLifecyclePolicyVersion: world.config.city.lifecyclePolicyVersion,
    rulesVersion: world.config.rules.version,
  };
  return {
    dimensions,
    interval: {
      fromWorldTime: from?.toISOString() ?? world.history[0]?.worldTime ?? null,
      throughWorldTime: through?.toISOString() ?? world.history.at(-1)?.worldTime ?? null,
    },
    socialLoop: {
      interactionStartRate: metric(interactions.length, coPresenceEpisodes.length),
      onTimeConversationResponseRate: metric(repliedNotificationIds.size, deliveredConversation.length),
      successfulConversationCompletionRate: metric(successfulInteractions.length, terminalInteractions.length),
      persistentConsequenceRate: metric(interactionsWithConsequence.length, interactions.length),
      agentTimeoutRate: metric(timeoutEvents.length, deliveredExpected.length),
      explicitSilenceCount: events.filter((event) => event.type === "SILENCE_RESOLVED" && event.data.explicit).length,
      platformSuppressedDeadlineCount: events.filter((event) => event.type === "DEADLINE_SUPPRESSED_FOR_PLATFORM_INCIDENT").length,
    },
    experiences,
    selectedContext,
    buildings: buildingMetrics(world, events, from, through),
    stories: {
      candidates: storyCandidates,
      candidatesPerActiveCharacterDay: metric(storyCandidates.length, activeCharacterDays.size),
      activeCharacterDays: activeCharacterDays.size,
    },
    ownerInterest: {
      ownerReturnWithin24Hours: metric(returningOwners.size, eligibleOwners.size),
      summaryOpenRate: metric([...summariesViewed].filter((id) => summariesAvailable.has(id)).length, summariesAvailable.size),
      interestingStoryRate: metric(ratings.filter((event) => event.data.rating >= 4).length, ratings.length),
      ratingResponseRate: metric([...ratingKeys].filter((key) => detailViews.has(key)).length, detailViews.size),
      ratingSampleCount: ratings.length,
    },
    operations: {
      agentRulesRequests: events.filter((event) => event.type === "AGENT_RULES_REQUESTED").length,
      maximumRulesManifestBytes: Math.max(0, ...events
        .filter((event) => event.type === "AGENT_RULES_REQUESTED")
        .map((event) => event.data.manifestBytes ?? 0)),
      unavailableAgents: [...world.state.characters.values()].filter((character) => character.agentAvailability === "unavailable").length,
      deliveredNotAcknowledged: [...world.state.notifications.values()].filter((notification) => notification.status === "delivered").length,
      acknowledgedNonResponses: events.filter((event) => event.type === "AGENT_NOTIFICATION_EXPIRED"
        && world.state.notifications.get(event.data.notificationEventId)?.ackEventId).length,
      deliveryFailures: events.filter((event) => event.type === "AGENT_NOTIFICATION_DELIVERY_FAILED").length,
      deadlineProcessingDelay: delaySummary(events
        .map((event) => event.data.processingDelayWorldMilliseconds)
        .filter(Number.isFinite)),
    },
  };
}

function buildingMetrics(world, events, from, through) {
  const paid = events.filter((event) => event.type === "BUILDING_UPKEEP_PAID");
  const scheduledPaid = paid.filter((event) => event.data.reason !== "reactivation");
  const failed = events.filter((event) => event.type === "BUILDING_UPKEEP_FAILED");
  const states = ["ACTIVE", "DELINQUENT", "INACTIVE", "CLOSED", "ABANDONED"];
  const duration = Object.fromEntries(states.map((state) => [state, 0]));
  const transitions = {
    BUILDING_ACTIVATED: "ACTIVE", BUILDING_REACTIVATED: "ACTIVE",
    BUILDING_DELINQUENT: "DELINQUENT", BUILDING_INACTIVATED: "INACTIVE",
    BUILDING_CLOSED: "CLOSED", BUILDING_ABANDONED: "ABANDONED",
  };
  const start = from?.getTime() ?? -Infinity;
  const end = through?.getTime() ?? world.clock.now().getTime();
  const current = new Map();
  const addDuration = (entry, until) => {
    if (!entry) return;
    duration[entry.status] += Math.max(0, Math.min(until, end) - Math.max(entry.at, start)) / 60_000;
  };
  for (const event of [...world.history].sort((a, b) => a.worldTime.localeCompare(b.worldTime) || a.sequence - b.sequence)) {
    const at = new Date(event.worldTime).getTime();
    if (at > end) continue;
    const status = transitions[event.type] ?? (!event.data.lifecyclePolicyVersion
      ? ({ BUILDING_UPKEEP_FAILED: "DELINQUENT", BUILDING_UPKEEP_PAID: "ACTIVE" })[event.type]
      : null);
    if (!status) continue;
    const id = event.data.buildingId;
    addDuration(current.get(id), at);
    current.set(id, { status, at });
  }
  for (const entry of current.values()) addDuration(entry, end);
  return {
    constructed: events.filter((event) => event.type === "BUILDING_CONSTRUCTION_STARTED").length,
    upkeepDue: scheduledPaid.length + failed.length,
    upkeepPaid: scheduledPaid.length,
    upkeepFailed: failed.length,
    upkeepCoverageRate: metric(scheduledPaid.length, scheduledPaid.length + failed.length),
    upkeepCreditsPaid: paid.reduce((sum, event) => sum + event.data.amount, 0),
    recoveryPayments: paid.length - scheduledPaid.length,
    reactivations: events.filter((event) => event.type === "BUILDING_REACTIVATED").length,
    warnings: events.filter((event) => event.type === "BUILDING_LIFECYCLE_WARNING").length,
    lifecycleTransitions: Object.fromEntries(states.map((state) => [state,
      events.filter((event) => event.data.status === state && transitions[event.type]).length])),
    currentStateCounts: Object.fromEntries(states.map((state) => [state,
      [...world.state.buildings.values()].filter((building) => building.status === state).length])),
    lifecycleWorldMinutes: Object.fromEntries(states.map((state) => [state, round2(duration[state])])),
  };
}

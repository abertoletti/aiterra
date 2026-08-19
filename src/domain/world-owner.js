// The owner-facing projection: the feed, return summaries, story details,
// ratings, and product metrics. These read history and report on it, and each
// takes the world rather than living on it, so the reporting surface can grow
// without enlarging the aggregate that owns the rules.
import { createHash } from "node:crypto";
import {
  DomainError, buildDescendantIndex, collectActiveCharacterDays, conflict, decodeOwnerCursor,
  delaySummary, encodeOwnerCursor, invalid, metric, ownerFeedCategory, ownerFeedDetails,
  ownerFeedTypes, projectStoryCandidates, requiredId, summaryPriority,
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

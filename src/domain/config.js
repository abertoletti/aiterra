export const defaultConfig = Object.freeze({
  clock: {
    realHoursPerGameDay: 4,
    realEpoch: "2026-01-01T00:00:00.000Z",
    gameEpoch: "2042-01-01T00:00:00.000Z",
  },
  energy: {
    maximum: 100,
    movementCost: 2,
    workCost: 15,
    eventAttendanceCost: 3,
    socialInteractionCost: 1,
    conversationTurnCost: 1,
    extendedConversationTurnCost: 2,
    restDurationGameMinutes: 60,
    restRecovery: 25,
    trainingCost: 10,
    trainingDurationGameMinutes: 60,
  },
  jobs: {
    escrowPolicyVersion: 1,
    currency: "credits",
    defaultOfferDurationWorldHours: 24,
    startGraceWorldHours: 2,
    employerCancellationWorkerShare: 0.2,
  },
  economy: {
    bootstrapBudgetId: "world-bootstrap",
    bootstrapCredits: 10_000,
    maximumOpenSystemJobs: 20,
  },
  movement: {
    durationGameMinutes: 15,
  },
  relationship: {
    policyVersion: 1,
    minimum: -100,
    maximum: 100,
    tensionMinimum: 0,
    tensionMaximum: 100,
    rules: {
      greeting_appreciated: { affinity: 1, trust: 0, tension: 0, sourceType: "subjective_appraisal", category: "greeting" },
      interaction_appreciated: { affinity: 2, trust: 0, tension: 0, sourceType: "subjective_appraisal", category: "interaction" },
      completed_help: { affinity: 1, trust: 3, tension: 0, sourceType: "objective_outcome", category: "help" },
      rejection_uncomfortable: { affinity: -1, trust: 0, tension: 2, sourceType: "subjective_appraisal", category: "rejection" },
      insult_offended: { affinity: -3, trust: 0, tension: 5, sourceType: "subjective_appraisal", category: "insult" },
      lie_discovered: { affinity: -1, trust: -6, tension: 3, sourceType: "objective_outcome", category: "lie" },
      promise_kept: { affinity: 1, trust: 4, tension: -1, sourceType: "objective_outcome", category: "promise" },
      promise_broken: { affinity: -2, trust: -8, tension: 4, sourceType: "objective_outcome", category: "promise" },
      expected_response_silence: { affinity: -1, trust: -1, tension: 1, sourceType: "silence", category: "silence" },
    },
  },
  relevance: {
    ruleVersion: 1,
    weights: {
      sameLocation: 25,
      knownRelationship: 20,
      strongRelationship: 40,
      directTarget: 50,
      compatibleActivity: 5,
      importantEventType: 5,
    },
    thresholds: {
      medium: 30,
      high: 60,
    },
    wakeAt: "HIGH",
  },
  goals: {
    policyVersion: 1,
    maximumActiveSecondaryGoals: 3,
    defaultSecondaryGoalWorldDays: 7,
    secondaryTypes: [
      "strengthen_relationship", "avoid_character", "attend_event",
      "resolve_conflict", "visit_location", "find_work",
    ],
  },
  timing: {
    policyVersion: 1,
    conversationResponseWorldMinutes: 8,
    conversationInactivityWorldMinutes: 20,
    highEventReactionWorldMinutes: 8,
    criticalEventReactionWorldMinutes: 2,
    unavailableAfterMissedResponses: 3,
  },
  conversation: {
    maximumMessageCharacters: 2_000,
    maximumTurns: 8,
    closingTurns: 3,
    extendedCostStartsAtTurn: 5,
    samePairCooldownWorldMinutes: 30,
    samePairFatigueWindowWorldMinutes: 120,
    samePairRepeatStartCost: 2,
    reflectionWindowWorldMinutes: 60,
    maximumSharedFactsPerTurn: 8,
    maximumTurnsPerWorldMinute: 10,
  },
  invitations: {
    policyVersion: 1,
    locationLeadWorldMinutes: 30,
    locationWindowWorldMinutes: 30,
    reminderWorldMinutes: 10,
    maximumOpenPerCharacter: 3,
  },
  rules: {
    version: "agent-rules-v2",
  },
  protocol: {
    version: "1.0",
    minimumCapabilities: ["observe", "act", "events", "ack"],
    requestBodyLimitBytes: 64 * 1024,
    rateLimitWindowMs: 60_000,
    rateLimitRequests: 120,
    maxSseConnectionsPerCharacter: 2,
    requireIdempotencyKey: true,
    requireExpectedStateVersion: true,
    requireVerifiedEventChannel: false,
  },
  ownerFeed: {
    paginationContractVersion: 1,
    authorizationProjectionVersion: 1,
    defaultPageSize: 50,
    maximumPageSize: 100,
    cursorTtlRealHours: 24,
    maximumSummaryHighlights: 10,
  },
  metrics: {
    definitionVersion: 1,
    worldConfigurationVersion: "prototype-1",
  },
});

export function makeConfig(overrides = {}) {
  return deepMerge(structuredClone(defaultConfig), overrides);
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] ?? {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

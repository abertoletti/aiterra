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
    // A repeatable post goes on cooldown when someone finishes it and returns, so the
    // board never empties and nothing has to expire for the world to stay busy.
    repeatCooldownGameMinutes: 30,
    currency: "credits",
    defaultOfferDurationWorldHours: 24,
    startGraceWorldHours: 2,
    employerCancellationWorkerShare: 0.2,
  },
  economy: {
    bootstrapBudgetId: "world-bootstrap",
    bootstrapCredits: 10_000,
    // Whether the city's treasury is bottomless. The engine supports both; which one a world
    // runs is a game-design decision and belongs in that world's configuration. Off here, so
    // a bounded budget stays the explicit default and every test says which it means.
    unlimitedCityBudget: false,
    maximumOpenSystemJobs: 20,
  },
  movement: {
    durationGameMinutes: 15,
    // The grid replaces the configured connection graph. 400 cells would need 160,000
    // explicit edges, so distance derives the duration instead and any cell is reachable
    // from any other. Manhattan, because a city is walked along streets.
    minutesPerCell: 5,
    minimumDurationGameMinutes: 5,
  },
  // City, building, and experience grammar policy v2.
  city: {
    gridVersion: 1,
    width: 20,
    height: 20,
    maximumFootprintWidth: 2,
    maximumFootprintHeight: 2,
    capacityPerCell: 10,
    capabilities: ["host_event", "create_job", "sell_access", "sell_service", "accept_donation"],
    // constructionCost = cells x (structural + profile x ambition^exponent), where
    // ambition is the sum of the ten profile dimensions over 100. Convex in the total
    // promised and neutral about its distribution: promising everything is not
    // forbidden, it is unaffordable.
    structuralCostPerCell: 200,
    profileCostPerCell: 300,
    ambitionExponent: 2,
    constructionMinutesPerCell: 20,
    upkeepDailyRate: 0.03,
    upkeepMinimum: 5,
    upkeepIntervalWorldMinutes: 1440,
    maximumBuildingsPerCharacter: 3,
    // A venue admits the public when it has something on, plus the time it takes to walk
    // there, so a resident can set out before the doors open instead of always arriving late.
    doorsOpenBeforeWorldMinutes: 30,
    nameMaximumLength: 80,
    descriptionMaximumLength: 500,
  },
  // City, building, and experience grammar policy v1, shared-taxonomy scope.
  grammar: {
    profileTaxonomyVersion: 1,
    profileDimensions: [
      "music", "socializing", "learning", "competition", "spirituality",
      "luxury", "adventure", "relaxation", "creativity", "nature",
    ],
    // Caring is the scarce resource; delivering is not. A profile has no budget so a
    // rich evening does not have to describe itself as a thin one.
    preferenceBudget: 500,
    // A tag is not authored, it is the name of a dimension the item actually delivers at
    // or above this value. An authored tag list could claim what the profile does not.
    tagThreshold: 30,
  },
  // Experience and Happiness policy v1.
  happiness: {
    policyVersion: 1,
    minimum: 0,
    maximum: 100,
    initial: 50,
    maximumChangePerExperience: 15,
    affinityPivot: 40,
    affinityScale: 0.15,
    affinityMinimum: -6,
    affinityMaximum: 9,
    // Presence is the small factor, interaction the large one.
    presenceValueBound: 2,
    interactionValueMaximum: 6,
    strangerImportance: 0.3,
    firstMeetingNovelty: 1.3,
    // Outcomes are declared by the perceiving brain, so no server-side classifier is
    // needed and a bad exchange can lower Happiness.
    interactionOutcomes: {
      "greeting:appreciated": 1,
      "interaction:appreciated": 1,
      "rejection:uncomfortable": -0.6,
      "insult:offended": -1,
      neutral: 0.1,
      unappraised: 0.3,
    },
    // Talking about something this resident cares about lands better than small talk.
    topicFitNeutral: 1,
    topicFitRange: 0.6,
    crowdBound: 2,
    repetitionPerPriorAttendance: 1.5,
    repetitionMinimum: -5,
    repetitionWindowWorldDays: 7,
    varianceBound: 1.5,
    decayPerWorldDay: 1,
    decayWindowWorldMinutes: 1440,
    decayFloor: 25,
    // Work pays Credits and costs Happiness, so the work/play tension is real rather
    // than rhetorical: a resident who only works is choosing Credits over a life.
    completedWorkCost: 1.5,
    // Interaction value saturates per person: MaxReward x (1 - e^(-k x turns)).
    interactionSaturationK: 0.55,
  },
  // Experience Energy policy v1 and experience commerce policy v1.
  experience: {
    energyPolicyVersion: 1,
    commercePolicyVersion: 1,
    entryEnergyCost: 3,
    marginalEnergyPerWorldMinutes: 30,
    marginalEnergyMaximum: 8,
    reEntryWindowWorldMinutes: 60,
    // Putting a night on is work, not a free announcement. It was free, and the pilot's one
    // proprietor answered by creating five events in nine real minutes - two of them three
    // seconds apart - all at her building's profile ceiling. The cost scales with what the
    // night promises, so a modest evening can be thrown often and a lavish one cannot.
    hostingBaseEnergyCost: 10,
    hostingEnergyPerAmbition: 15,
    minimumAccessPrice: 0,
    maximumAccessPrice: 200,
  },
  // AIT-1201. Skills gated work and nothing ever changed them: a resident five points short
  // of a requirement was five points short for the life of the world, and across one pilot
  // 33,102 of 97,695 job affordances were blocked by a skill that could never be gained.
  //
  // You learn from work that stretches you. A post requiring R teaches until you reach
  // R + masteryMargin, and the gain shrinks as you approach that ceiling: routine work
  // teaches nothing, which is what makes harder work worth seeking. The policy shape is
  // fixed by the course and skill progression policy; these are the calibration values it
  // left open.
  skills: {
    policyVersion: 1,
    set: ["social", "business", "creativity", "technical", "fitness"],
    minimum: 0,
    maximum: 100,
    masteryMargin: 20,
    gainPerCompletion: 4,
  },
  relationship: {
    policyVersion: 2,
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
      response_window_missed: { affinity: -1, trust: 0, tension: 1, sourceType: "silence", category: "silence" },
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
    // A world that runs twice as fast must not give a brain half the time to think.
    // Deadlines stay expressed in world minutes, as the approved policy has them, but a
    // deadline never buys less wall-clock than it would at the reference clock speed the
    // policy was calibrated against. Proportional rather than a flat floor, so the
    // ordering critical < high < conversation survives at any speed.
    //
    // Measured: at 2 real hours per world day an 8-world-minute reply deadline is 40
    // real seconds, against an end-to-end path - notify, poll, observe, queue, infer,
    // submit - that routinely takes 25-40s. Four of seven brains were marked unavailable
    // in one run because of it.
    referenceRealHoursPerGameDay: 4,
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
    version: "agent-rules-v3",
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

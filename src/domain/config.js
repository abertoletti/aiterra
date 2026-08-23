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
    // Coverage is collective above one, and five is where "a team" stops being a
    // coordination story and starts being a queue.
    maximumTeamSize: 5,
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
  // Personal mobility policy v1. A garage, not a slot: a resident may own every catalog
  // entry and chooses per trip how to travel - the move action takes a vehicleId, omitted
  // means on foot. One disclosed effect per vehicle: it multiplies travel time, never below
  // the movement floor, and its usage cost is charged whenever it is ridden - the choice is
  // the rider's, made against options whose minutes and wear are both stated up front.
  // Sold by the city, always and only: vehicles are a power-up, not a market residents can
  // enter. Purchase and wear both retire credits (the money becomes the machine), because
  // the v8 pilot ended with the rich hoarding: the economy needs sinks that are strategy.
  vehicles: {
    policyVersion: 1,
    catalog: [
      {
        id: "bicycle",
        // 0.6 turns the pilot's 35-minute square-to-square walk into 21: enough to feel,
        // not enough to erase the geography that makes each board a local market.
        travelTimeFactor: 0.6,
        // Priced at a good day's work (pilot wages run 12-257): the first mobility rung
        // should be reachable by anyone who wants it within a session.
        price: 200,
        // Nominal wear: one errand's pay covers a dozen rides.
        usageCost: 1,
      },
      {
        id: "car",
        // 0.3 turns the 70-minute diagonal into 21: the whole city inside one decision
        // cycle, which is exactly why it has to cost like a building.
        travelTimeFactor: 0.3,
        price: 1800,
        // A tenth of a skilled wage per trip: real friction, so walking stays a choice.
        usageCost: 10,
      },
    ],
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
  // Experience and Happiness policy v2: v1 plus the repetition grace run.
  happiness: {
    policyVersion: 2,
    minimum: 0,
    maximum: 100,
    initial: 50,
    maximumChangePerExperience: 15,
    affinityPivot: 40,
    affinityScale: 0.15,
    affinityMinimum: -6,
    affinityMaximum: 9,
    // Presence is the small factor, interaction the large one. Each co-present person
    // contributes (affinity - tension) / presenceValueDivisor toward the bounded total.
    presenceValueBound: 2,
    presenceValueDivisor: 200,
    interactionValueMaximum: 6,
    strangerImportance: 0.3,
    firstMeetingNovelty: 1.3,
    // How much a person matters scales with |affinity| + tension over this divisor,
    // clamped between strangerImportance and 1.
    importanceDivisor: 100,
    // How much of the planned evening you were actually there for. First matching band
    // wins; the null band is "otherwise". Walking out after a minute is worse than not
    // coming, staying to the end is the only positive.
    participationBands: [
      { belowShare: 0.10, value: -4 },
      { belowShare: 0.40, value: -2 },
      { belowShare: 0.75, value: 0 },
      { belowShare: null, value: 2 },
    ],
    // Fill ratio mapped to a crowd feeling: round(fill x scale) - offset, then clamped
    // to crowdBound - an empty room reads lonely, a full one reads alive.
    crowdFillScale: 4,
    crowdFillOffset: 2,
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
    // The first few similar evenings are free. The penalty used to bite from the SECOND
    // visit, and in the v8 pilot it warned every guest of the city's first venue off its
    // second night - a rule meant to stop a rut taxed loyalty before a habit existed, and
    // a venue needs regulars before it can have bored ones.
    repetitionFreeAttendances: 5,
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
  // AIT-1205. Work teaches only what it demands, so a resident below every rung on its own
  // square can never climb: Nia stood at Foundry Square with technical 15 under a lowest
  // technical rung of 25, and the one post she could take taught nothing. A course is the
  // priced way INTO a skill you cannot yet work in - which is also why the reverted
  // `teaches` field stays out: free menial learning would undercut the thing a course sells.
  //
  // Mechanical effects come only from this approved catalog. A provider - the city or a
  // resident - picks an entry, a skill from the controlled set, and a price inside the
  // entry's band; it can never author the numbers.
  courses: {
    policyVersion: 1,
    catalogVersion: 1,
    // Same shape as a job's start window: tuition buys a seat, not an open-ended option.
    startGraceWorldHours: 2,
    // Offering a course is a free announcement, and free announcements get spammed - the
    // pilot's one proprietor created five events in nine minutes when hosting cost nothing.
    maximumOpenCoursesPerBuilding: 2,
    catalog: [
      {
        id: "foundations",
        // +12 gets a resident below a 25-rung over it in one sitting (15 -> 27), and the
        // 40 ceiling ends a course's usefulness exactly where real work takes over: work
        // demanding 25 teaches to 45. Free work at your level gains 4 per completion, so
        // a course is three completions' worth of a skill work cannot give you - a way in,
        // never a cheaper ladder up.
        gain: 12,
        teachesTo: 40,
        prerequisite: null,
        tradeoffLoss: null,
        durationGameMinutes: 45,
        // In line with what a 45-minute post costs (the pilot board runs ~minutes/1.8),
        // because sitting a course must compete with a shift for the same day.
        energyCost: 20,
        // The band brackets five errands' pay (12 each): reachable by exactly the work a
        // locked-out resident can still do, and never so cheap that skipping the errands
        // is free.
        priceMinimum: 40,
        priceMaximum: 120,
      },
      {
        id: "specialization",
        // Deepens an already-working skill toward mastery (70 stays short of the 100 cap:
        // the last stretch belongs to demanding work alone) and charges a disclosed cost
        // in another skill - the policy's required tradeoff, not a decoration.
        gain: 10,
        teachesTo: 70,
        // You specialize in something you already do: the foundations ceiling is where
        // this course becomes enterable, so the two entries chain instead of competing.
        prerequisite: 30,
        tradeoffLoss: 3,
        durationGameMinutes: 90,
        energyCost: 35,
        priceMinimum: 100,
        priceMaximum: 300,
      },
    ],
  },
  // AIT-1202, Domain Reputation policy v1. Domains are the five work skills: work is the
  // only verified outcome stream running today, and hiring - the first reader of reputation
  // - states its requirements in exactly these axes, so a track record in any other taxonomy
  // would be one no decision could consume. Experience-dimension domains arrive with
  // contributor outcomes (AIT-1608) as a new taxonomy version.
  reputation: {
    policyVersion: 1,
    domainTaxonomyVersion: 1,
    minimum: 0,
    maximum: 100,
    // Reliability is earned in units and lost in multiples: four completions and one
    // no-show should leave a visible dent, or a no-show is just a day off.
    weights: {
      work_completed: { general: 2, domain: 3 },
      work_no_show: { general: -8, domain: -6 },
      work_abandoned: { general: -6, domain: -5 },
      work_cancelled: { general: -3, domain: 0 },
      commitment_kept: { general: 1, domain: 0 },
      commitment_missed: { general: -4, domain: 0 },
      // Per attendee whose evening actually resolved well, so an empty or bad night
      // grants nothing; the repetition rule caps how much one night can pay.
      experience_hosted: { general: 2, domain: 0 },
    },
    // The pilot's twenty-seven completions landed on three job ids: without a window the
    // same standing post is a reputation pump. The multipliers price each repeat of the
    // same evidence inside the window, in order; beyond the list it pays nothing. The
    // window slides, so a track record maintained over days keeps counting while a burst
    // does not.
    repetitionWindowWorldDays: 2,
    repetitionMultipliers: [1, 0.5],
  },
  relationship: {
    policyVersion: 2,
    minimum: -100,
    maximum: 100,
    tensionMinimum: 0,
    tensionMaximum: 100,
    // A repeated positive appraisal of the same kind on the same day pays less, then
    // nothing: affection cannot be minted by saying "appreciated" in a loop.
    appraisalRepetitionMultipliers: [1, 0.5],
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
    // A relationship counts as strong for attention purposes at this strength.
    strongRelationshipStrength: 60,
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
    // v2 adds pursue_goal. Nia formed the v8 pilot's best intention - "I need 2001 credits
    // for a 1x1 venue... I'll accept needs-survey, then rest, then build" - and re-derived
    // it from scratch every turn, because no goal type could hold it: the vocabulary
    // covered people, places, and work, and a multi-step goal of one's own is none of
    // those. A pursue_goal goal is self-authored memory: no target, no automatic
    // completion, just the goal's own words returning in every observation until it is
    // abandoned or expires.
    policyVersion: 2,
    maximumActiveSecondaryGoals: 3,
    defaultSecondaryGoalWorldDays: 7,
    secondaryTypes: [
      "strengthen_relationship", "avoid_character", "attend_event",
      "resolve_conflict", "visit_location", "find_work", "pursue_goal",
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
    version: "agent-rules-v7",
  },
  protocol: {
    version: "1.0",
    minimumCapabilities: ["observe", "act", "events", "ack"],
    // Content caps, not balance: how many causal events a declared decision may cite and
    // how many traits a persona may carry.
    maximumDecisionCauses: 12,
    maximumPersonalityTraits: 12,
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

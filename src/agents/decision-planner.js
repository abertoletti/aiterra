const MAX_MESSAGE_CHARACTERS = 2_000;
const MAX_SHARED_FACTS = 8;
const ALLOWED_CONTEXT_FILTERS = [
  "locationId", "minimumCompensation", "feasibleOnly",
  "startsAfter", "startsBefore", "subjectCharacterId",
  "tag", "minimumAffinity", "maximumPrice",
  "availableOnly", "maximumDistance",
];

export class DecisionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DecisionValidationError";
    this.code = "INVALID_AGENT_DECISION";
  }
}

export class AgentDecisionPlanner {
  constructor({ modelClient }) {
    if (!modelClient || typeof modelClient.complete !== "function") throw new Error("A model client is required");
    this.modelClient = modelClient;
  }

  async decide({
    observation, history = [], recentActionFailures = [], signal = null,
    rules = null, catalogs = {}, contextRequestsRemaining = 0,
  }) {
    const messages = buildDecisionMessages(observation, history, recentActionFailures, {
      rules, catalogs, contextRequestsRemaining,
    });
    const response = await this.modelClient.complete({ messages, signal });
    try {
      const document = parseDecisionDocument(response.content);
      const common = {
        rationale: typeof document.rationale === "string" ? document.rationale.slice(0, 500) : null,
        providerResponseId: response.responseId,
        usage: response.usage,
        rawContent: response.content,
        // What the model was actually told. Behaviour was debugged for three runs
        // against a log that recorded the observation and never the instructions, which
        // makes "the prompt does not mention X" unfalsifiable from the evidence.
        systemPrompt: messages[0]?.content ?? null,
        systemPromptDigest: digestOf(messages[0]?.content ?? ""),
      };
      // The brain may answer a decision with a request for detail instead of an
      // action, but only while requests remain: past the budget it must decide on
      // what it has, so a runtime cannot loop on asking.
      //
      // Both envelopes are accepted. Models overwhelmingly wrap the request inside
      // `action`, because the output contract says to answer with an action - and for
      // three runs every one of those was rejected as an unavailable action type, which
      // read from the outside as agents never asking for anything.
      const requested = document.requestContext ?? asContextRequest(document.action);
      if (contextRequestsRemaining > 0 && requested) {
        return { ...common, contextRequest: validateContextRequest(requested, observation) };
      }
      return { ...common, action: validateAction(document.action ?? document, observation, history) };
    } catch (error) {
      if (error instanceof DecisionValidationError) {
        error.rawModelContent = response.content.slice(0, 10_000);
        error.providerResponseId = response.responseId;
        error.usage = response.usage;
      }
      throw error;
    }
  }
}

// A request wearing an action's clothes. `resource` is the only field that matters, and
// the shape a model reaches for varies, so all the plausible ones are read.
export function asContextRequest(action) {
  if (!action || typeof action !== "object") return null;
  const type = typeof action.type === "string" ? action.type.toLowerCase().replace(/[_-]/g, "") : "";
  if (!["requestcontext", "inspectcontext", "requestcatalog", "inspect"].includes(type)) return null;
  const resource = action.resource ?? action.requestContext?.resource ?? action.catalog;
  if (typeof resource !== "string") return null;
  return { resource, filters: action.filters ?? action.requestContext?.filters ?? {} };
}

export function buildDecisionMessages(observation, history = [], recentActionFailures = [], {
  rules = null, catalogs = {}, contextRequestsRemaining = 0,
} = {}) {
  if (!observation || typeof observation !== "object") throw new Error("An Aiterra observation is required");
  const progressive = observation.contextMode === "progressive";
  // In progressive mode the observation omits the manifest body and the runtime supplies
  // the copy it cached by version.
  const activeRules = observation.rules ?? rules ?? null;
  // Ordered most-stable-first, because the provider caches by exact prefix and one changed
  // byte discards everything after it. Measured across 1,001 real observations, field by
  // field, comparing each against the same character's previous one: character identity,
  // relationships, knowledge, commitments and invitations never changed; recentConversations
  // changed 2% of the time; availableActions 28% - and it is 13.5 KB of an 18 KB payload,
  // so where it sits decides almost everything. summaries changed 54% of the time and
  // worldTime 100%.
  //
  // worldTime was first. It is the smallest field in the prompt at 0.03 KB and the only one
  // that changes every single call, so it invalidated the whole payload at its first byte:
  // nothing in the user message was ever cached, which matches the 16.3% overall hit rate
  // coming entirely from the system message. Simulating this order against the same
  // observations caches 70% of the payload instead of none.
  //
  // The order is load-bearing. Moving a volatile field earlier silently costs money without
  // failing anything, which is why prompt-prefix-stability.test.js pins it.
  const context = {
    // Never changed in the measurement.
    relationships: observation.relationships,
    knowledge: observation.knowledge,
    commitments: observation.commitments ?? [],
    invitations: observation.invitations ?? [],
    // Rarely changes, and carries the bulk of the bytes.
    recentConversations: observation.recentConversations ?? [],
    // The map: real, fully described, not yet possible. It changes more slowly than the
    // menu does, so it sits ahead of it in the prefix.
    opportunities: observation.opportunities,
    availableActions: observation.availableActions,
    requiredActionShapes: actionShapes(observation.availableActions ?? []),
    availableJobs: observation.availableJobs ? observation.availableJobs.map(compactJob) : undefined,
    jobBoards: observation.jobBoards,
    pendingNotifications: observation.pendingNotifications,
    activeConversations: observation.activeConversations,
    // The prompt names cityTonight three times as the way to find a night worth going
    // to. It was computed into every observation and then dropped here, so the model was
    // told to consult a field it had never seen - and asked for the experiences catalog
    // 65 times, every one empty, at a full extra call each.
    cityTonight: observation.cityTonight,
    upcomingEvents: observation.upcomingEvents,
    nearby: observation.nearby,
    // The moment: this is where the prefix is expected to break.
    cannotRightNow: observation.cannotRightNow,
    character: observation.character,
    decision: observation.decision,
    summaries: observation.summaries,
    recentActionFailures: recentActionFailures.slice(-5),
    recentPermittedHistory: history.slice(-12).map(compactHistoryEvent),
    // Only the catalogs this decision actually asked for, and only on the turn it asked.
    catalogs: Object.keys(catalogs).length > 0 ? catalogs : undefined,
    rulesVersion: observation.rulesVersion,
    // Last on purpose: it changes every call and everything after it would be uncacheable.
    worldTime: observation.worldTime,
  };
  const contextProtocol = progressive && contextRequestsRemaining > 0
    ? [
      "This observation is deliberately compact. `summaries` reports, per resource, how many items you know and how many are currently possible; a low feasibleCount is not an empty world.",
      "To ask, answer with {\"requestContext\":{\"resource\":\"<a resource named in summaries>\",\"filters\":{}},\"rationale\":\"why you need it\"} and you will be asked again with that catalog included. Ask whenever you are about to choose blind: before choosing where to build, before deciding there is nothing worth attending, or when you want to know what other residents have built.",
      `You may request detail ${contextRequestsRemaining} more time(s) for this decision; after that, decide with what you have.`,
      "Do not request a catalog you already received below, and do not request one whose summary shows nothing you could act on.",
    ]
    : [];
  return [
    {
      role: "system",
      // Written as a scannable spec, not prose. The previous version was 52 flowing
      // sentences joined by spaces, and three runs produced a world of almost nothing
      // but conversation: an instruction buried at sentence 43 of a wall of text is an
      // instruction the model will not weigh. Short lines, grouped by when they apply.
      content: [
        "You are one resident of Aiterra, a persistent world. Every other resident is another player's character.",
        "",
        "## What you are playing for",
        "- credits you earn",
        "- livedHappiness: rises only from experiences you attend and resolve. Work lowers it.",
        "- relationships that come to matter",
        "A run ends and is judged on those three.",
        "",
        "## Your first turn, if you have not arrived",
        "You are not in the city yet. `squares` lists the four public squares: what their notice board asks for and pays, how many notices are open, and how many residents already stand there.",
        "Choose one with {\"type\":\"enter_world\",\"locationId\":...}. It is the only thing you can do, it costs nothing, and it decides who your neighbours are and what work is under your nose. Pick the square whose work matches what you are good at, or whose crowd matches what you are for - and say which in your rationale.",
        "",
        "## Every turn",
        "- pick exactly ONE action from availableActions. Everything in it can be done right now: there is no feasibility to check.",
        "- opportunities is the rest of the world: real, fully described, not yet possible. blockedBy says what stands in the way. This is what you plan from.",
        "- cannotRightNow states a reason that blocks a whole class of action at once. Read it before concluding there is nothing to do.",
        "- match requiredActionShapes exactly; required fields must be non-empty",
        "- never invent an id, a number, an outcome, a balance or a fact",
        "- never repeat an action the server has already rejected until something has changed",
        "- never claim movement, work, attendance, possession or construction happened unless observation or history confirms it",
        "",
        "## If a reply is pending",
        "It has a deadline, so answer it: send_message | remain_silent | end_conversation.",
        "- topics: at most 2 profile dimensions. Talking about what the OTHER person cares about is worth more.",
        "- respect turnsRemaining; closingRecommended means conclude now",
        "- appraise_interaction once after a conversation ends",
        "- conversation is how you learn things and arrange what happens next. Close it once its purpose is met, then go do the thing you agreed.",
        "",
        "## If nothing is pending — this is where a run is won",
        "Talking to whoever is standing there is one option among these, not the default.",
        ...(contextProtocol.length > 0
          ? ["FIRST, IF YOU DO NOT KNOW WHAT IS OUT THERE, ASK. Answer with a requestContext instead of an action and you will be asked again with the catalog included. Use `experiences` to see what is on across the city, `plots` to find land worth buying, `buildings` to see what other residents have built and where the crowds are, `opportunities` for work, `people` for who is around. Asking costs you one decision and is how you stop acting blind."]
          : []),
        "{\"type\":\"rest\"} recovers restRecovery Energy over restDurationGameMinutes world minutes. It is available whenever you are idle and it is not on the list below, because when to spend Energy and when to get it back is yours to judge.",
        "Work through this list in order and take the first one that applies. An entry that costs more Energy than you hold will be refused, so read energyCost before choosing it.",
        "1a. APPLICANTS ARE WAITING ON A ROLE YOU PUBLISHED -> {\"type\":\"select_applicant\",...}. Each application carries the candidate's verified reputation, general and per domain; the wage is already reserved. Pick before offerExpiresAt or the escrow returns and nobody works.",
        "1b. YOU OWN A BUILDING WITH TAKINGS IN IT -> {\"type\":\"publish_role\",...}. The city's wages never change; a role you publish may pay anything up to the building balance.",
        "    Employ a resident out of the building balance and pin the notice on a public square from boardChoices, because nobody can stand inside a venue that is shut. Staff are admitted even when the doors are.",
        "    Your role is filled by application: candidates apply at the board and you choose with select_applicant. You may also demand a minimum Domain Reputation in reputationRequirements.",
        "1. YOU OWN A BUILDING WITH NO EVENT RUNNING -> {\"type\":\"host_experience\",...}. A building admits nobody while it has nothing on, and upkeep is charged whether or not anyone comes.",
        "   Hosting is work and costs Energy on what the night promises: hostingBaseEnergyCost + hostingEnergyPerAmbition x (sum of your chosen profile / 100). A lavish night can cost more than a shift.",
        "   One night at a time per building. If bookedUntil is set, the room is taken: use startsInGameMinutes to programme the next free slot instead of resubmitting.",
        "2. SOMETHING IN cityTonight SUITS YOU (high affinity, affordable) -> {\"type\":\"move\",\"destinationId\":...}, then {\"type\":\"attend_event\",\"eventId\":...} once you are there. cityTonight lists every public experience with its affinity for you, its price and how far away it is.",
        "   affinity is out of 100 and is what that night is worth TO YOU. A low one costs credits and Energy to be made LESS happy.",
        "   repetition on each night states your own habit: priorSimilarAttendances similar nights inside the window, of which freeAttendances cost nothing, and factor is the penalty already earned past that free run. Read it before paying, not after.",
        "   A venue is open only while it has something on: a `move` to a shut one says BUILDING_CLOSED and carries opensAt to plan around.",
        "3. YOU CAN AFFORD A BUILDING AND HAVE NONE -> {\"type\":\"construct_building\",\"x\":...,\"y\":...}. One action: pick any free cell and it is yours. Build near where people already are; check cityTonight and nearby for where that is. The affordance names cheapestUsefulBuilding and takenCells.",
        "4. YOU ARE SHORT OF CREDITS -> {\"type\":\"accept_job\",\"jobId\":...} then {\"type\":\"start_job\",\"jobId\":...}.",
        "   A notice states its energyCost as well as its pay: they vary a lot now. Short errands cost little and pay little; long skilled work costs a third of your Energy and pays many times more. Compare pay against energyCost, not against pay alone.",
        "   Each notice says what completing it TEACHES, in skillGains. A post that demands a skill you lack is not a wall: do the work on this board that raises it and come back. Routine work below your level teaches nothing.",
        "   WORK IS FOUND IN THE SQUARES. Each square has its own notice board and you read only the one you are standing in. jobBoards lists every square, how many notices and courses are waiting there and how far away it is. If this square has nothing for you, move to one that does.",
        "   A notice with hiring 'application' is a resident's role: apply_for_role at its board, then carry on - you are committed only if selected. The proprietor reads your reputation when it selects.",
        "4b. THE SKILL BETTER WORK DEMANDS IS ONE NO REACHABLE POST TEACHES -> {\"type\":\"enroll_course\",...} at its board, move to its location, then {\"type\":\"start_course\",...} within the window. The notice states price, duration, energy, prerequisites and the EXACT effects for you before you pay.",
        "    effects is computed for YOU: each entry says what completion changes from your current level. A course whose every delta is 0 changes nothing you have, at full price.",
        "    Tuition is never refunded: abandoning, cancelling or missing the start forfeits it. Work that stretches you teaches for nothing (skillGains).",
        "",
        "## Building, and then running it",
        "- there is no land to buy. Building claims the ground: name a free cell and a footprint (1x1 up to 2x2) and every cell of it becomes yours.",
        "- profile = what your place delivers, on the ten dimensions. Cost = cells x (structural + profileCost x ambition^2), ambition = sum of your profile values / 100. Squared, so broad profiles are unaffordable: pick 2-3 dimensions.",
        "- capacity comes from footprint alone; your building's profile is the CEILING on every experience you host there",
        "- to host: pick a title and description, a profile at or under your ceiling (omit `profile` and it uses your building's own), a duration, and an accessPrice from 0 to maximumAccessPrice.",
        "- what each attendee pays goes to the BUILDING balance; upkeep is charged from that balance, and from your own credits when it cannot cover it",
        "- a building with sell_service can offer_course: pick a catalog entry, a skill, a price in the entry's band and a square for the notice. Tuition goes to the building balance, like admission.",
        "- residents come only if the night suits them and they can reach it. You cannot make them come; you can only put on something worth coming to.",
        "- `plots` lists free cells, `buildings` shows what others built and where the crowds are; rules.city has the exact numbers",
        "",
        "## Goals",
        "- keep at least one active secondary goal whenever you have capacity",
        "- propose_secondary_goal needs a sourceEventId you actually perceived (from recentPermittedHistory or a pendingNotification) and a targetId listed in `known`",
        "- goals persist: use them to stay on a plan instead of reconsidering from scratch",
        "- anything stated only in a rationale is gone next turn; a goal returns every turn in character.secondaryGoals with its declaredReason. Formed a multi-step goal - save 2000 then build, finish a course then take the post it opens? Pin it: goal type pursue_goal, targetId null, the steps and their numbers in declaredReason.",
        "- abandon one explicitly when it is achieved or no longer makes sense",
        "",
        "## Also available",
        "- buy_vehicle: the city sells mobility. One owned slot, buying replaces it with no refund. It rides automatically when it shortens a trip: move durations you see already include it, and its usageCost in credits is charged only on trips it actually shortened.",
        "- reputation is public and moves only on verified outcomes: completed work builds it in the skills the post demanded, no-shows and broken promises spend it faster. Proprietors read it when they hire.",
        "- send_invitation / respond_invitation turn dialogue into an arrangement",
        "- team jobs: check workerIds, openTeamSlots, requirementsMode, teamSkillCoverageAfterJoin. Joining is a commitment.",
        "- act consistently with your personality, goals, knowledge, relationships, energy and commitments",
        "- the versioned rules object is authoritative; apply it before choosing",
        ...(contextProtocol.length > 0 ? ["", "## Asking for detail", ...contextProtocol.map((line) => `- ${line}`)] : []),
        "",
        "## Output",
        "JSON only, no markdown. Either act:",
        "{\"action\":{...},\"rationale\":\"one short sentence\"}",
        ...(contextProtocol.length > 0
          ? ["or ask for a catalog first, which is a different top-level key and NOT an action:",
            "{\"requestContext\":{\"resource\":\"experiences\",\"filters\":{}},\"rationale\":\"why you need it\"}"]
          : []),
        // The manifest lives at the end of the stable message rather than in the volatile
        // context object. Both are identical for a whole rules version, and the provider
        // caches by exact prefix: measured, 1,280 of ~9,600 tokens per call were cached,
        // which is exactly this system message and nothing more, because the user message
        // begins with worldTime and breaks the prefix at its first byte. Cached input bills
        // at roughly a seventh of fresh input.
        ...(activeRules ? ["", "## Rules (authoritative)", JSON.stringify(activeRules)] : []),
      ].join("\n"),
    },
    { role: "user", content: JSON.stringify(context) },
  ];
}

// A brain may ask for detail, but only for a resource the observation named and
// with the filters the contract allows. Everything else is the server's business.
export function validateContextRequest(candidate, observation) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new DecisionValidationError("The context request must be an object");
  }
  const resource = text(candidate.resource, "context resource", 40);
  const offered = (observation.summaries ?? []).map((summary) => summary.resource);
  if (!offered.includes(resource)) {
    throw new DecisionValidationError(`Context resource ${resource} is not offered by this observation`);
  }
  const filters = {};
  for (const [key, value] of Object.entries(candidate.filters ?? {})) {
    if (!ALLOWED_CONTEXT_FILTERS.includes(key)) {
      throw new DecisionValidationError(`Context filter ${key} is not allowed`);
    }
    filters[key] = value;
  }
  return { resource, filters };
}

function compactJob(job) {
  return {
    id: job.id,
    title: job.title,
    locationId: job.locationId,
    durationGameMinutes: job.durationGameMinutes,
    compensation: job.compensation,
    requirements: job.requirements,
    status: job.status,
    workerId: job.workerId,
    workerIds: job.workerIds,
    teamSize: job.teamSize,
    openTeamSlots: job.openTeamSlots,
    requirementsMode: job.requirementsMode,
    energyCost: job.energyCost,
    scheduledStartAt: job.scheduledStartAt,
    startGraceUntil: job.startGraceUntil,
    offerExpiresAt: job.offerExpiresAt,
  };
}

function compactHistoryEvent(event) {
  const data = event?.data && typeof event.data === "object"
    ? Object.fromEntries(Object.entries(event.data).filter(([key]) => !["worldConfigurationVersion", "reservation"].includes(key)))
    : event?.data;
  return {
    id: event?.id,
    type: event?.type,
    worldTime: event?.worldTime,
    actorCharacterId: event?.actorCharacterId,
    subjectCharacterId: event?.subjectCharacterId,
    causedByEventIds: event?.causedByEventIds,
    data,
  };
}

function actionShapes(availableActions) {
  const types = new Set(availableActions.map((action) => action.type));
  const shapes = {};
  for (const type of types) {
    switch (type) {
      case "move": shapes.move = { type: "move", destinationId: "<an offered destinationId>" }; break;
      case "construct_building": shapes.construct_building = {
        type,
        x: "<x, 1..gridWidth, a cell not in takenCells>", y: "<y, 1..gridHeight>",
        width: "<1 or 2>", height: "<1 or 2, and you must own every cell of the rectangle>",
        name: "<required, what you call the place>",
        description: "<required, what it is; free text, no mechanical effect>",
        profile: "<object of profile dimensions to 0-100; what the place delivers, priced convexly>",
        capabilities: "<array from the offered capabilities>",
      }; break;
      case "enter_world": shapes.enter_world = {
        type, locationId: "<the square you choose to begin in>",
      }; break;
      case "buy_vehicle": shapes.buy_vehicle = {
        type, vehicleId: "<a vehicleId from the offered catalog>",
      }; break;
      case "publish_role": shapes.publish_role = {
        type, buildingId: "<one of your ACTIVE buildings>",
        boardLocationId: "<a square from boardChoices: the notice goes there>",
        title: "<the role>", description: "<the duties>",
        requirements: "<object of skill -> 0..100, only skills in skillSet>",
        durationGameMinutes: "<integer>", wage: "<integer, paid from the building balance>",
      }; break;
      case "host_experience": shapes.host_experience = {
        type,
        buildingId: "<one of your active buildings>",
        title: "<required name of the night>",
        description: "<required free text>",
        profile: "<optional: object of dimensions, none above profileCeiling. Omit to deliver exactly what your building delivers>",
        startsInGameMinutes: "<integer, 0 or more>",
        durationGameMinutes: "<integer, at least 1>",
        accessPrice: "<integer credits, 0 for free>",
        capacity: "<optional integer up to maximumCapacity>",
      }; break;
      case "fund_building": shapes.fund_building = {
        type, buildingId: "<one of your buildings>", credits: "<positive integer>",
      }; break;
      case "start_conversation": shapes.start_conversation = {
        type: "start_conversation",
        targetCharacterId: "<an offered targetCharacterId>",
        openingMessage: "<required non-empty natural dialogue, 1-2000 characters>",
      }; break;
      case "send_message": shapes.send_message = {
        type: "send_message",
        conversationId: "<an offered conversationId>",
        text: "<required non-empty natural dialogue, 1-2000 characters>",
        sharedFacts: [],
        topics: "<optional, at most two profile dimensions this turn was about>",
      }; break;
      case "end_conversation": shapes.end_conversation = { type, conversationId: "<an offered conversationId>" }; break;
      case "remain_silent": shapes.remain_silent = { type, conversationId: "<an offered conversationId>" }; break;
      case "ignore_event": shapes.ignore_event = { type, notificationEventId: "<an offered notificationEventId>" }; break;
      case "appraise_interaction": shapes.appraise_interaction = {
        type,
        conversationId: "<an offered conversationId>",
        otherCharacterId: "<the offered otherCharacterId>",
        interactionKind: "<a key from allowedAppraisals>",
        appraisal: "<a value allowed for that interactionKind>",
      }; break;
      case "accept_job":
      case "start_job":
      case "cancel_job":
      case "apply_for_role":
      case "withdraw_application": shapes[type] = { type, jobId: "<an offered jobId>" }; break;
      case "select_applicant": shapes.select_applicant = {
        type, jobId: "<a role you published>",
        applicationId: "<an applicationId from that role's applications list>",
      }; break;
      case "enroll_course":
      case "start_course":
      case "abandon_course": shapes[type] = { type, courseId: "<an offered courseId>" }; break;
      case "offer_course": shapes.offer_course = {
        type, buildingId: "<one of your buildings with sell_service>",
        catalogEntryId: "<an id from the offered courseCatalog>",
        skill: "<a skill from skillSet the course will teach>",
        tradeoffSkill: "<required only for entries with a tradeoffLoss: a distinct skill that pays it>",
        price: "<integer inside the entry's priceMinimum..priceMaximum>",
        boardLocationId: "<a square from boardChoices: the notice goes there>",
        title: "<what you call the course>", description: "<free text, no mechanical effect>",
      }; break;
      case "attend_event": shapes.attend_event = { type, eventId: "<an offered eventId>" }; break;
      case "leave_experience": shapes.leave_experience = { type, eventId: "<the eventId you are attending>" }; break;
      case "send_invitation": shapes.send_invitation = {
        type,
        targetCharacterId: "<an offered targetCharacterId>",
        destinationType: "location | event",
        destinationId: "<the offered destinationId>",
        message: "<required concise invitation, 1-2000 characters>",
      }; break;
      case "respond_invitation": shapes.respond_invitation = {
        type, invitationId: "<an offered invitationId>", response: "accept | decline",
      }; break;
      case "rest": shapes.rest = { type: "rest" }; break;
      case "abandon_secondary_goal": shapes.abandon_secondary_goal = { type, goalId: "<an offered goalId>" }; break;
      case "propose_secondary_goal": shapes.propose_secondary_goal = {
        type,
        goal: {
          type: "<an allowedGoalType>", targetId: "<visible target or null>",
          sourceEventId: "<a visible causal event id>", priority: "low | medium | high",
          declaredReason: "<required concise reason>",
        },
      }; break;
      default: break;
    }
  }
  return shapes;
}

export function parseDecisionDocument(content) {
  if (typeof content !== "string" || !content.trim()) throw new DecisionValidationError("The model returned an empty decision");
  const trimmed = content.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next conservative extraction strategy.
    }
  }
  throw new DecisionValidationError("The model decision is not a valid JSON object");
}

export function validateAction(candidate, observation, history = []) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new DecisionValidationError("The model action must be an object");
  }
  const type = text(candidate.type, "action type", 100);
  const templates = (observation.availableActions ?? []).filter((action) => action.type === type);
  if (templates.length === 0) throw new DecisionValidationError(`Action ${type} is not currently available`);

  switch (type) {
    case "move":
      return matchedIdentifierAction(type, "destinationId", candidate, templates);
    case "start_conversation": {
      const action = matchedIdentifierAction(type, "targetCharacterId", candidate, templates);
      return { ...action, openingMessage: text(candidate.openingMessage, "openingMessage", MAX_MESSAGE_CHARACTERS) };
    }
    case "send_message": {
      const topics = candidate.topics === undefined || candidate.topics === null
        ? []
        : (Array.isArray(candidate.topics) ? candidate.topics.slice(0, 2).map((topic) => text(String(topic), "topic", 40)) : []);
      const action = matchedIdentifierAction(type, "conversationId", candidate, templates);
      return {
        ...action,
        text: text(candidate.text, "message text", MAX_MESSAGE_CHARACTERS),
        sharedFacts: validateSharedFacts(candidate.sharedFacts ?? []),
        // The server revalidates against the controlled taxonomy and rejects an
        // invented topic, so passing it through unchecked is safe and honest.
        ...(topics.length > 0 ? { topics } : {}),
      };
    }
    case "end_conversation":
    case "remain_silent":
      return matchedIdentifierAction(type, "conversationId", candidate, templates);
    case "ignore_event":
      return matchedIdentifierAction(type, "notificationEventId", candidate, templates);
    case "appraise_interaction": {
      const template = templates.find((item) => item.conversationId === candidate.conversationId
        && item.otherCharacterId === candidate.otherCharacterId);
      if (!template) throw new DecisionValidationError("The appraisal does not match an available conversation");
      const interactionKind = text(candidate.interactionKind ?? "interaction", "interactionKind", 50);
      const allowed = template.allowedAppraisals?.[interactionKind] ?? [];
      if (!allowed.includes(candidate.appraisal)) throw new DecisionValidationError("The appraisal is not allowed for that interaction kind");
      return {
        type, conversationId: template.conversationId, otherCharacterId: template.otherCharacterId,
        interactionKind, appraisal: candidate.appraisal,
      };
    }
    case "accept_job":
    case "start_job":
    case "cancel_job":
    case "apply_for_role":
    case "withdraw_application":
      return matchedIdentifierAction(type, "jobId", candidate, templates);
    case "select_applicant": {
      const action = matchedIdentifierAction(type, "jobId", candidate, templates);
      const template = templates.find((item) => item.jobId === action.jobId);
      const applicationId = text(candidate.applicationId, "applicationId", 100);
      if (!(template.applications ?? []).some((application) => application.applicationId === applicationId)) {
        throw new DecisionValidationError("applicationId does not match a pending application on that role");
      }
      return { ...action, applicationId };
    }
    case "enroll_course":
    case "start_course":
    case "abandon_course":
      return matchedIdentifierAction(type, "courseId", candidate, templates);
    case "offer_course": {
      const buildingId = text(candidate.buildingId, "buildingId", 100);
      const envelope = templates.find((item) => item.buildingId === buildingId);
      if (!envelope) throw new DecisionValidationError("That building is not one of yours that can teach");
      const catalogEntryId = text(candidate.catalogEntryId, "catalogEntryId", 100);
      const entry = (envelope.courseCatalog ?? []).find((item) => item.catalogEntryId === catalogEntryId);
      if (!entry) throw new DecisionValidationError("catalogEntryId is not in the offered course catalog");
      const skill = text(candidate.skill, "course skill", 40);
      if (!(envelope.skillSet ?? []).includes(skill)) throw new DecisionValidationError(`${skill} is not an offered skill`);
      let tradeoffSkill = null;
      if (entry.tradeoffLoss) {
        tradeoffSkill = text(candidate.tradeoffSkill, "tradeoffSkill", 40);
        if (!(envelope.skillSet ?? []).includes(tradeoffSkill) || tradeoffSkill === skill) {
          throw new DecisionValidationError("The tradeoff must name a distinct offered skill");
        }
      } else if (candidate.tradeoffSkill) {
        throw new DecisionValidationError("This catalog entry carries no tradeoff to assign a skill to");
      }
      const boardLocationId = text(candidate.boardLocationId, "boardLocationId", 100);
      if (!(envelope.boardChoices ?? []).some((choice) => choice.locationId === boardLocationId)) {
        throw new DecisionValidationError("A course is advertised on one of the public squares in boardChoices");
      }
      return {
        type, buildingId, catalogEntryId, skill,
        ...(tradeoffSkill ? { tradeoffSkill } : {}),
        price: boundedInteger(candidate.price, "price", entry.priceMinimum, entry.priceMaximum),
        boardLocationId,
        title: text(candidate.title, "course title", 120),
        description: text(candidate.description ?? "", "course description", 500),
      };
    }
    case "attend_event":
    case "leave_experience":
      return matchedIdentifierAction(type, "eventId", candidate, templates);
    case "send_invitation": {
      const targetCharacterId = text(candidate.targetCharacterId, "targetCharacterId", 100);
      const destinationType = text(candidate.destinationType, "destinationType", 20);
      const destinationId = text(candidate.destinationId, "destinationId", 100);
      // The affordance declares an envelope rather than every combination, so the
      // runtime checks the shape and the declared destination types. Whether this
      // particular person and place are allowed stays the server's call, as it is
      // for every other action.
      const envelope = templates[0] ?? {};
      if (!(envelope.destinationTypes ?? ["location", "event"]).includes(destinationType)) {
        throw new DecisionValidationError("The invitation destination type is not offered");
      }
      if (envelope.openInvitationsRemaining === 0) {
        throw new DecisionValidationError("No open invitation slots remain");
      }
      return { type, targetCharacterId, destinationType, destinationId, message: text(candidate.message, "invitation message", MAX_MESSAGE_CHARACTERS) };
    }
    case "respond_invitation": {
      const invitationId = text(candidate.invitationId, "invitationId", 100);
      const response = text(candidate.response, "invitation response", 20);
      const template = templates.find((item) => item.invitationId === invitationId);
      if (!template || !(template.allowedResponses ?? []).includes(response)) {
        throw new DecisionValidationError("The invitation response is not offered");
      }
      return { type, invitationId, response };
    }
    case "rest":
      return { type };
    // Authorship. The runner checks shape and bounds against the declared envelope; the
    // server remains the authority on ownership, price and every other consequence.
    case "construct_building": {
      const envelope = templates[0] ?? {};
      const maximum = envelope.maximumFootprint ?? { width: 2, height: 2 };
      const capabilities = Array.isArray(candidate.capabilities) ? [...new Set(candidate.capabilities)] : [];
      if (capabilities.length === 0) throw new DecisionValidationError("A building needs at least one capability");
      for (const capability of capabilities) {
        if (!(envelope.capabilities ?? []).includes(capability)) {
          throw new DecisionValidationError(`Capability ${capability} is not offered`);
        }
      }
      return {
        type,
        x: boundedInteger(candidate.x, "x", 1, 20),
        y: boundedInteger(candidate.y, "y", 1, 20),
        width: boundedInteger(candidate.width ?? 1, "width", 1, maximum.width),
        height: boundedInteger(candidate.height ?? 1, "height", 1, maximum.height),
        name: text(candidate.name, "building name", 80),
        description: text(candidate.description, "building description", 500),
        profile: profileObject(candidate.profile, envelope.profileDimensions ?? []),
        capabilities,
      };
    }
    case "enter_world":
      return matchedIdentifierAction(type, "locationId", candidate, templates);
    case "buy_vehicle": {
      const vehicleId = text(candidate.vehicleId, "vehicleId", 40);
      const envelope = templates[0] ?? {};
      if (!(envelope.catalog ?? []).some((vehicle) => vehicle.vehicleId === vehicleId)) {
        throw new DecisionValidationError("vehicleId is not in the offered vehicle catalog");
      }
      return { type, vehicleId };
    }
    case "publish_role": {
      const buildingId = text(candidate.buildingId, "buildingId", 100);
      const envelope = templates.find((item) => item.buildingId === buildingId);
      if (!envelope) throw new DecisionValidationError("That building is not one of yours to employ from");
      const boardLocationId = text(candidate.boardLocationId, "boardLocationId", 100);
      if (!(envelope.boardChoices ?? []).some((choice) => choice.locationId === boardLocationId)) {
        throw new DecisionValidationError("A role is advertised on one of the public squares in boardChoices");
      }
      const wage = boundedInteger(candidate.wage, "wage", 1, envelope.balance ?? 0);
      return {
        type, buildingId, boardLocationId, wage,
        title: text(candidate.title, "role title", 120),
        description: text(candidate.description ?? "", "role duties", 500),
        requirements: profileObject(candidate.requirements ?? {}, envelope.skillSet ?? []),
        durationGameMinutes: boundedInteger(candidate.durationGameMinutes, "durationGameMinutes", 1, 1440),
      };
    }
    case "host_experience": {
      const buildingId = text(candidate.buildingId, "buildingId", 100);
      const envelope = templates.find((item) => item.buildingId === buildingId);
      if (!envelope) throw new DecisionValidationError("That building is not one of yours to host in");
      // Omitted profile means "whatever this place delivers", which the server resolves
      // from the building itself. Hosting should not require composing a vector.
      const profile = candidate.profile === undefined || candidate.profile === null
        ? null
        : profileObject(candidate.profile, Object.keys(envelope.profileCeiling ?? {}));
      for (const [dimension, value] of Object.entries(profile ?? {})) {
        if (value > (envelope.profileCeiling?.[dimension] ?? 0)) {
          throw new DecisionValidationError(`The building cannot deliver ${dimension} above ${envelope.profileCeiling?.[dimension] ?? 0}`);
        }
      }
      const accessPrice = boundedInteger(candidate.accessPrice ?? 0, "accessPrice", 0,
        envelope.canChargeAdmission ? (envelope.maximumAccessPrice ?? 200) : 0);
      return {
        type, buildingId,
        title: text(candidate.title, "experience title", 120),
        description: text(candidate.description, "experience description", 500),
        ...(profile ? { profile } : {}),
        startsInGameMinutes: boundedInteger(candidate.startsInGameMinutes ?? 0, "startsInGameMinutes", 0, 1440),
        durationGameMinutes: boundedInteger(candidate.durationGameMinutes, "durationGameMinutes", 1, 1440),
        accessPrice,
        ...(candidate.capacity === undefined || candidate.capacity === null
          ? {}
          : { capacity: boundedInteger(candidate.capacity, "capacity", 1, envelope.maximumCapacity ?? 10) }),
      };
    }
    case "fund_building": {
      const buildingId = text(candidate.buildingId, "buildingId", 100);
      const envelope = templates.find((item) => item.buildingId === buildingId);
      if (!envelope) throw new DecisionValidationError("That building is not one of yours to fund");
      return {
        type, buildingId,
        credits: boundedInteger(candidate.credits, "credits", 1, Math.max(1, envelope.credits ?? 1)),
      };
    }
    case "abandon_secondary_goal":
      return matchedIdentifierAction(type, "goalId", candidate, templates);
    case "propose_secondary_goal":
      return validateSecondaryGoal(candidate, templates[0], observation, history);
    default:
      throw new DecisionValidationError(`Action ${type} is not supported by the pilot runner`);
  }
}

// A short stable fingerprint, so a reader can tell at a glance whether every decision in
// a run was made under the same instructions without re-reading them all.
function digestOf(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  return `${(hash >>> 0).toString(16)}-${text.length}`;
}

function boundedInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new DecisionValidationError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}

// A profile is the one structured field an authoring action carries, so it is checked
// here rather than trusted: unknown dimensions are rejected, never quietly dropped.
function profileObject(value, allowedDimensions) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DecisionValidationError("profile must be an object of profile dimensions");
  }
  const profile = {};
  for (const [dimension, raw] of Object.entries(value)) {
    if (allowedDimensions.length > 0 && !allowedDimensions.includes(dimension)) {
      throw new DecisionValidationError(`${dimension} is not a profile dimension`);
    }
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 0 || number > 100) {
      throw new DecisionValidationError(`profile ${dimension} must be an integer between 0 and 100`);
    }
    if (number > 0) profile[dimension] = number;
  }
  if (Object.keys(profile).length === 0) {
    throw new DecisionValidationError("A profile must deliver at least one dimension above zero");
  }
  return profile;
}

export function safeFallbackAction(observation) {
  const notificationId = observation.decision?.notificationEventId;
  const notification = (observation.pendingNotifications ?? []).find((item) => item.eventId === notificationId);
  if (notification?.requestKind === "conversation_response") {
    const template = (observation.availableActions ?? []).find((action) =>
      action.type === "remain_silent" && action.conversationId === notification.conversationId);
    if (template) return { type: "remain_silent", conversationId: template.conversationId };
  }
  if (notification) {
    const template = (observation.availableActions ?? []).find((action) =>
      action.type === "ignore_event" && action.notificationEventId === notification.eventId);
    if (template) return { type: "ignore_event", notificationEventId: template.notificationEventId };
  }
  return null;
}

function matchedIdentifierAction(type, field, candidate, templates) {
  const value = text(candidate[field], field, 100);
  const template = templates.find((item) => item[field] === value);
  if (!template) throw new DecisionValidationError(`${field} does not match an available ${type} action`);
  return { type, [field]: value };
}

function validateSharedFacts(facts) {
  if (!Array.isArray(facts) || facts.length > MAX_SHARED_FACTS) {
    throw new DecisionValidationError(`sharedFacts must contain at most ${MAX_SHARED_FACTS} items`);
  }
  return facts.map((fact) => {
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) throw new DecisionValidationError("Every shared fact must be an object");
    const id = text(fact.id, "fact id", 100);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id)) throw new DecisionValidationError("A shared fact id is invalid");
    const perceivedReliability = fact.perceivedReliability ?? "unknown";
    if (!["unknown", "low", "medium", "high"].includes(perceivedReliability)) {
      throw new DecisionValidationError("A shared fact reliability is invalid");
    }
    return {
      id,
      claim: text(fact.claim, "fact claim", 500),
      subjectId: fact.subjectId ? text(String(fact.subjectId), "fact subjectId", 100) : null,
      perceivedReliability,
    };
  });
}

function validateSecondaryGoal(candidate, template, observation, history) {
  const goal = candidate.goal;
  if (!goal || typeof goal !== "object" || Array.isArray(goal)) throw new DecisionValidationError("A secondary goal object is required");
  const type = text(goal.type, "goal type", 100);
  if (!(template.allowedGoalTypes ?? []).includes(type)) throw new DecisionValidationError("The secondary goal type is not allowed");
  const sourceEventId = text(goal.sourceEventId, "goal sourceEventId", 100);
  const visibleEventIds = new Set([
    ...history.map((event) => event.id),
    ...(observation.pendingNotifications ?? []).flatMap((item) => [item.eventId, item.sourceEventId]).filter(Boolean),
  ]);
  if (!visibleEventIds.has(sourceEventId)) throw new DecisionValidationError("The secondary goal source is not visible to the character");
  const priority = goal.priority ?? "medium";
  if (!["low", "medium", "high"].includes(priority)) throw new DecisionValidationError("The secondary goal priority is invalid");
  const targetId = goal.targetId ? text(String(goal.targetId), "goal targetId", 100) : null;
  validateGoalTarget(type, targetId, observation);
  return {
    type: "propose_secondary_goal",
    goal: {
      type, targetId, sourceEventId, priority,
      declaredReason: text(goal.declaredReason, "goal declaredReason", 500),
    },
  };
}

// Prefers observation.known, which both context modes carry as identifiers, and falls
// back to the full-mode records. Reading only the records silently rejected almost
// every goal in progressive mode, since that is where those records stop being sent.
function validateGoalTarget(type, targetId, observation) {
  const known = observation.known ?? {};
  const knownCharacters = new Set(known.characterIds
    ?? [...(observation.relationships ?? []).map((item) => item.characterId),
      ...(observation.nearby ?? []).map((item) => item.id)]);
  const knownLocations = new Set(known.locationIds ?? [
    observation.character?.locationId,
    ...(observation.availableActions ?? []).filter((item) => item.type === "move").map((item) => item.destinationId),
  ].filter(Boolean));
  const knownEvents = new Set(known.eventIds ?? (observation.upcomingEvents ?? []).map((item) => item.id));

  if (type === "pursue_goal") {
    if (targetId) throw new DecisionValidationError("A pursue_goal goal lives in declaredReason and takes no target");
  } else if (["strengthen_relationship", "avoid_character", "resolve_conflict"].includes(type)) {
    if (!targetId || !knownCharacters.has(targetId)) throw new DecisionValidationError("The secondary goal character target is not known");
  } else if (type === "visit_location") {
    if (!targetId || !knownLocations.has(targetId)) throw new DecisionValidationError("The visit-location target is not visible");
  } else if (type === "attend_event") {
    if (!targetId || !knownEvents.has(targetId)) throw new DecisionValidationError("The attend-event target is not visible");
  } else if (type === "find_work" && targetId) {
    if (!knownLocations.has(targetId)) throw new DecisionValidationError("The find-work location is not visible");
  }
}

function text(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new DecisionValidationError(`${label} must contain 1-${maximum} characters`);
  }
  return value.trim();
}

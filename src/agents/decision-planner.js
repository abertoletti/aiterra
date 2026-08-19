const MAX_MESSAGE_CHARACTERS = 2_000;
const MAX_SHARED_FACTS = 8;
const ALLOWED_CONTEXT_FILTERS = [
  "locationId", "minimumCompensation", "feasibleOnly",
  "startsAfter", "startsBefore", "subjectCharacterId",
  "tag", "minimumAffinity", "maximumPrice",
  "availableOnly", "ownedByMe", "maximumDistance",
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
    const response = await this.modelClient.complete({
      messages: buildDecisionMessages(observation, history, recentActionFailures, {
        rules, catalogs, contextRequestsRemaining,
      }),
      signal,
    });
    try {
      const document = parseDecisionDocument(response.content);
      const common = {
        rationale: typeof document.rationale === "string" ? document.rationale.slice(0, 500) : null,
        providerResponseId: response.responseId,
        usage: response.usage,
        rawContent: response.content,
      };
      // The brain may answer a decision with a request for detail instead of an
      // action, but only while requests remain: past the budget it must decide on
      // what it has, so a runtime cannot loop on asking.
      if (contextRequestsRemaining > 0 && document.requestContext) {
        return { ...common, contextRequest: validateContextRequest(document.requestContext, observation) };
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

export function buildDecisionMessages(observation, history = [], recentActionFailures = [], {
  rules = null, catalogs = {}, contextRequestsRemaining = 0,
} = {}) {
  if (!observation || typeof observation !== "object") throw new Error("An Aiterra observation is required");
  const progressive = observation.contextMode === "progressive";
  const context = {
    worldTime: observation.worldTime,
    rulesVersion: observation.rulesVersion,
    // In progressive mode the observation omits the manifest body and the runtime
    // supplies the copy it cached by version.
    rules: observation.rules ?? rules ?? undefined,
    decision: observation.decision,
    character: observation.character,
    nearby: observation.nearby,
    relationships: observation.relationships,
    activeConversations: observation.activeConversations,
    recentConversations: observation.recentConversations ?? [],
    knowledge: observation.knowledge,
    availableJobs: observation.availableJobs ? observation.availableJobs.map(compactJob) : undefined,
    upcomingEvents: observation.upcomingEvents,
    pendingNotifications: observation.pendingNotifications,
    invitations: observation.invitations ?? [],
    commitments: observation.commitments ?? [],
    summaries: observation.summaries,
    // Only the catalogs this decision actually asked for.
    catalogs: Object.keys(catalogs).length > 0 ? catalogs : undefined,
    availableActions: observation.availableActions,
    requiredActionShapes: actionShapes(observation.availableActions ?? []),
    recentActionFailures: recentActionFailures.slice(-5),
    recentPermittedHistory: history.slice(-12).map(compactHistoryEvent),
  };
  const contextProtocol = progressive && contextRequestsRemaining > 0
    ? [
      "This observation is deliberately compact. `summaries` reports, per resource, how many items you know and how many are currently possible; a low feasibleCount is not an empty world.",
      "If and only if the detail would change your decision, answer with {\"requestContext\":{\"resource\":\"<a resource named in summaries>\",\"filters\":{}},\"rationale\":\"why you need it\"} and you will be asked again with that catalog included.",
      `You may request detail ${contextRequestsRemaining} more time(s) for this decision; after that, decide with what you have.`,
      "Do not request a catalog you already received below, and do not request one whose summary shows nothing you could act on.",
    ]
    : [];
  return [
    {
      role: "system",
      content: [
        "You control one character in Aiterra, a server-authoritative social world.",
        "Act consistently with the character's personality, goals, knowledge, relationships, energy, and current commitments.",
        "The versioned rules object is authoritative and is supplied on every decision. Apply it before choosing an action.",
        "Choose exactly one action from availableActions. Never invent IDs, mechanical values, outcomes, balances, durations, or hidden facts.",
        "Availability is informative: feasibility.status=blocked means the server is expected to reject the attempt, but you may deliberately try once when the character has a concrete reason. Never repeat the same rejected action until relevant state changes.",
        "Follow requiredActionShapes exactly. Fields shown as required must be present and non-empty; availableActions contains valid IDs but may omit required natural-language fields.",
        "If a conversation response is pending, prioritize send_message, remain_silent, or end_conversation.",
        "Use concise natural dialogue. Shared facts must be claims the character actually knows.",
        "Declare what a turn was about with 'topics', at most two of the profile dimensions listed in rules.happiness.profileDimensions. A conversation about something the other person cares about lands better than small talk, and an honest appraisal afterwards is what decides whether it went well or badly for you.",
        "Conversation turns consume energy. Respect turnsRemaining, avoid repetitive acknowledgements, and appraise or end once the purpose is met; closingRecommended means conclude now instead of starting another topic.",
        "Use authoritative invitations to turn dialogue into action: invite a known resident to an offered location or event, and accept or decline incoming invitations according to character intent.",
        "For team jobs, inspect workerIds, openTeamSlots, requirementsMode, and teamSkillCoverageAfterJoin; joining is a commitment and the server starts only a complete eligible team.",
        "Dialogue can propose future plans, but never claim that movement, work, attendance, possession, construction, inspection, or completion happened unless authoritative observation or history confirms it.",
        "After an ended conversation, prioritize one honest appraisal.",
        // The first pilot adopted zero goals in 165 actions. It was obeying us: the
        // previous wording said to adopt one "only when" something concrete emerged,
        // and nothing else in the prompt asked the character to want anything.
        "Your character should be pursuing something. Keep at least one active secondary goal whenever you have capacity for it, and propose one as soon as a perceived event gives you a reason: someone worth knowing better, a rivalry, work worth finding, a place or gathering worth reaching.",
        "A secondary goal needs a sourceEventId you actually perceived - take it from recentPermittedHistory or a pendingNotification - and a targetId listed in `known` (known.characterIds, known.locationIds, known.eventIds). Goals persist across decisions, so use them to stay on a plan instead of reconsidering from scratch each time.",
        "Abandon a goal explicitly when it is achieved or no longer makes sense, rather than leaving it to expire.",
        // The first runs produced almost no attendance because every affordance to enter
        // an experience only appears once you are already standing there, and nothing
        // told the character to close that gap. It was obeying us again.
        "A gathering you have not travelled to is still available to you. Request the `experiences` catalog to see what the whole city is offering, filter it by a tag you care about or by minimumAffinity, and if something suits you then `move` to its location first and attend once you arrive. Its affinity, price, both energy costs and how repetitive it would be for you are all disclosed before you commit.",
        "Credits are for spending. Working without ever attending anything leaves you richer and with a life you did not live, and the lived total is part of what a run is won on.",
        "You may also build. Request the `plots` catalog to see buyable land and the `buildings` catalog to see what already exists, then `acquire_plot` and `construct_building` to create a place that is yours: you choose its name, its description and what it delivers. Consult rules.city for the exact cost formula and the ceiling rule before choosing a profile, and prefer a focused profile over a broad one because breadth is priced out of reach.",
        "Once your building is active you can `host_experience` there within its profile ceiling, charge admission if it can sell access, and `fund_building` to cover upkeep. Other residents will decide for themselves whether your night is worth their credits and energy — you cannot make them come.",
        ...contextProtocol,
        "Return JSON only, without markdown: {\"action\":{...},\"rationale\":\"one short sentence\"}.",
      ].join(" "),
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
      case "acquire_plot": shapes.acquire_plot = {
        type, x: "<integer 1..gridWidth>", y: "<integer 1..gridHeight>",
      }; break;
      case "construct_building": shapes.construct_building = {
        type,
        x: "<x of a plot you own>", y: "<y of a plot you own>",
        width: "<1 or 2>", height: "<1 or 2, and you must own every cell of the rectangle>",
        name: "<required, what you call the place>",
        description: "<required, what it is; free text, no mechanical effect>",
        profile: "<object of profile dimensions to 0-100; what the place delivers, priced convexly>",
        capabilities: "<array from the offered capabilities>",
      }; break;
      case "host_experience": shapes.host_experience = {
        type,
        buildingId: "<one of your active buildings>",
        title: "<required name of the night>",
        description: "<required free text>",
        profile: "<object of dimensions, none above the building's profileCeiling>",
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
      case "cancel_job": shapes[type] = { type, jobId: "<an offered jobId>" }; break;
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
      return matchedIdentifierAction(type, "jobId", candidate, templates);
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
    case "acquire_plot": {
      const envelope = templates[0] ?? {};
      return {
        type,
        x: boundedInteger(candidate.x, "x", 1, envelope.gridWidth ?? 20),
        y: boundedInteger(candidate.y, "y", 1, envelope.gridHeight ?? 20),
      };
    }
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
    case "host_experience": {
      const buildingId = text(candidate.buildingId, "buildingId", 100);
      const envelope = templates.find((item) => item.buildingId === buildingId);
      if (!envelope) throw new DecisionValidationError("That building is not one of yours to host in");
      const profile = profileObject(candidate.profile, Object.keys(envelope.profileCeiling ?? {}));
      for (const [dimension, value] of Object.entries(profile)) {
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
        profile,
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

  if (["strengthen_relationship", "avoid_character", "resolve_conflict"].includes(type)) {
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

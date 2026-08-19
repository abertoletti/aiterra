const MAX_MESSAGE_CHARACTERS = 2_000;
const MAX_SHARED_FACTS = 8;
const ALLOWED_CONTEXT_FILTERS = [
  "locationId", "minimumCompensation", "feasibleOnly",
  "startsAfter", "startsBefore", "subjectCharacterId",
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
      const action = matchedIdentifierAction(type, "conversationId", candidate, templates);
      return {
        ...action,
        text: text(candidate.text, "message text", MAX_MESSAGE_CHARACTERS),
        sharedFacts: validateSharedFacts(candidate.sharedFacts ?? []),
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
    case "abandon_secondary_goal":
      return matchedIdentifierAction(type, "goalId", candidate, templates);
    case "propose_secondary_goal":
      return validateSecondaryGoal(candidate, templates[0], observation, history);
    default:
      throw new DecisionValidationError(`Action ${type} is not supported by the pilot runner`);
  }
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

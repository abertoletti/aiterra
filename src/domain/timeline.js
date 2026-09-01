const visibleTypes = new Set([
  "CHARACTER_CREATED",
  "RELATIONSHIP_CREATED",
  "RELATIONSHIP_CHANGED",
  "MOVEMENT_STARTED",
  "CHARACTER_ARRIVED",
  "CO_PRESENCE_STARTED",
  "CO_PRESENCE_ENDED",
  "AGENT_NOTIFICATION_QUEUED",
  "CONVERSATION_STARTED",
  "CONVERSATION_MESSAGE_SENT",
  "KNOWLEDGE_LEARNED",
  "CONVERSATION_ENDED",
  "CONVERSATION_TURN_EXPIRED",
  "SILENCE_RESOLVED",
  "AGENT_REACTION_TIMED_OUT",
  "JOB_CREATED",
  "JOB_TEAM_MEMBER_JOINED",
  "JOB_TEAM_MEMBER_LEFT",
  "JOB_ACCEPTED",
  "JOB_STARTED",
  "JOB_COMPLETED",
  "JOB_CANCELLED",
  "JOB_FAILED",
  "SKILL_CHANGED",
  "JOB_EXPIRED",
  "CREDITS_TRANSFERRED",
  "EVENT_CREATED",
  "EVENT_ATTENDANCE_STARTED",
  "EVENT_ATTENDANCE_ENDED",
  "EXPERIENCE_EXPECTATION_DECLARED",
  "EXPERIENCE_HAPPINESS_RESOLVED",
  "INVITATION_SENT",
  "INVITATION_ACCEPTED",
  "INVITATION_DECLINED",
  "INVITATION_EXPIRED",
  "COMMITMENT_CREATED",
  "COMMITMENT_REMINDER_SENT",
  "COMMITMENT_WINDOW_OPENED",
  "COMMITMENT_KEPT",
  "COMMITMENT_MISSED",
  "ENERGY_CHANGED",
  "REST_STARTED",
  "REST_COMPLETED",
  "SECONDARY_GOAL_ADOPTED",
  "SECONDARY_GOAL_COMPLETED",
  "SECONDARY_GOAL_ABANDONED",
  "SECONDARY_GOAL_EXPIRED",
  "DECISION_RECORDED",
  "VEHICLE_PURCHASED",
  "COURSE_OFFERED",
  "COURSE_ENROLLED",
  "COURSE_STARTED",
  "COURSE_COMPLETED",
  "COURSE_ABANDONED",
  "REPUTATION_CHANGED",
  "DOMAIN_REPUTATION_CHANGED",
  "BUILDING_ROLE_APPLIED",
  "BUILDING_ROLE_APPLICATION_WITHDRAWN",
  "BUILDING_ROLE_FILLED",
  "BUILDING_ROLE_CANDIDATE_REJECTED",
  "BUILDING_DELINQUENT", "BUILDING_INACTIVATED", "BUILDING_REACTIVATED",
  "BUILDING_LIFECYCLE_WARNING", "BUILDING_CLOSED", "BUILDING_ABANDONED",
]);

export function buildTimeline(events, options = {}) {
  const characterNames = new Map();
  const locationNames = new Map();
  for (const event of events) {
    if (event.type === "CHARACTER_CREATED") characterNames.set(event.data.id, event.data.name);
    if (event.type === "LOCATION_DEFINED") locationNames.set(event.data.id, event.data.name);
  }

  const name = (id) => characterNames.get(id) ?? id ?? "System";
  const location = (id) => locationNames.get(id) ?? id;

  return events
    .filter((event) => visibleTypes.has(event.type))
    .filter((event) => !options.characterId || concernsCharacter(event, options.characterId))
    .map((event) => ({
      id: event.id,
      at: event.worldTime,
      type: event.type,
      causedByEventIds: event.causedByEventIds,
      text: describe(event, name, location),
    }));
}

function concernsCharacter(event, characterId) {
  if (event.actorCharacterId === characterId || event.subjectCharacterId === characterId) return true;
  const data = event.data ?? {};
  return [data.characterId, data.fromId, data.toId, data.workerId, data.creatorId]
    .includes(characterId) || data.participantIds?.includes(characterId);
}

function describe(event, name, location) {
  const data = event.data;
  switch (event.type) {
    case "CHARACTER_CREATED":
      return `${data.name} entered the world at ${location(data.locationId)}.`;
    case "RELATIONSHIP_CHANGED":
      return `${name(data.fromId)}'s ${humanize(data.dimension ?? "affinity")} toward ${name(data.toId)} changed ${signed(data.delta)} to ${data.value} (${humanize(data.rule ?? data.outcome ?? "world event")}).`;
    case "RELATIONSHIP_CREATED":
      return `${name(data.fromId)} formed a directional relationship toward ${name(data.toId)} (affinity ${data.affinity}, trust ${data.trust}, tension ${data.tension}).`;
    case "MOVEMENT_STARTED":
      return `${name(data.characterId)} started travelling from ${location(data.fromLocationId)} to ${location(data.destinationId)}.`;
    case "CHARACTER_ARRIVED":
      return `${name(data.characterId)} arrived at ${location(data.locationId)}.`;
    case "CO_PRESENCE_STARTED":
      return `${name(data.participantIds[0])} and ${name(data.participantIds[1])} became co-present at ${location(data.locationId)}.`;
    case "CO_PRESENCE_ENDED":
      return `${name(data.participantIds[0])} and ${name(data.participantIds[1])} stopped being co-present at ${location(data.locationId)}.`;
    case "AGENT_NOTIFICATION_QUEUED":
      return `${name(data.characterId)}'s external brain was interrupted (${data.level}): ${data.summary}`;
    case "CONVERSATION_STARTED":
      return `${name(data.initiatorId)} started a conversation with ${name(data.targetId)} at ${location(data.locationId)}.`;
    case "CONVERSATION_MESSAGE_SENT":
      return `${name(data.senderId)} said: “${data.text}”`;
    case "KNOWLEDGE_LEARNED":
      return `${name(data.characterId)} learned “${data.fact.claim}” from ${name(data.sourceCharacterId)}.`;
    case "CONVERSATION_ENDED":
      return `${name(data.endedById)} ended the conversation (${humanize(data.reason ?? "participant ended")}, ${data.turnCount ?? 0} turns).`;
    case "CONVERSATION_TURN_EXPIRED":
      return `${name(data.characterId)} did not answer the expected conversation turn before its deadline.`;
    case "SILENCE_RESOLVED":
      return `${name(data.characterId)} remained silent${data.explicit ? " by explicit choice" : " after the response deadline"}.`;
    case "AGENT_REACTION_TIMED_OUT":
      return `${name(data.characterId)} did not react before the event deadline.`;
    case "JOB_CREATED":
      return `${name(data.creatorId)} offered ${data.compensation} credits for “${data.title}” at ${location(data.locationId)}; payment entered escrow.`;
    case "JOB_ACCEPTED":
      return `${(data.workerIds ?? [data.workerId]).map(name).join(" and ")} accepted “${data.title}”.`;
    case "JOB_TEAM_MEMBER_JOINED":
      return `${name(data.workerId)} joined the team for “${data.title}” (${data.workerIds.length}/${data.teamSize}).`;
    case "JOB_TEAM_MEMBER_LEFT":
      return `${name(data.workerId)} left job team ${data.jobId} before it formed.`;
    case "JOB_STARTED":
      return `${name(data.workerId)} started “${data.title}” at ${location(data.locationId)} until ${shortTime(data.expectedEndAt)}.`;
    case "JOB_COMPLETED":
      return `${name(data.workerId)} completed “${data.title}”.`;
    case "SKILL_CHANGED":
      return `${name(data.characterId)} got better at ${data.skill}: ${data.previous} to ${data.value}.`;
    case "JOB_CANCELLED":
    case "JOB_FAILED":
    case "JOB_EXPIRED":
      return `Job ${data.jobId} became ${humanize(data.terminalStatus)} (${humanize(data.terminalCause)}).`;
    case "CREDITS_TRANSFERRED":
      return `${data.amount} credits moved from ${name(data.fromCharacterId)}'s escrow to ${name(data.toCharacterId)}.`;
    case "EVENT_CREATED":
      return `“${data.title}” was scheduled at ${location(data.locationId)}.`;
    case "EVENT_ATTENDANCE_STARTED":
      return `${name(data.characterId)} started attending “${data.title}” at ${location(data.locationId)}.`;
    case "EVENT_ATTENDANCE_ENDED":
      return `${name(data.characterId)} finished attending “${data.title}”.`;
    case "EXPERIENCE_EXPECTATION_DECLARED":
      return `${name(data.characterId)} expected experience ${data.eventId} to be worth ${signed(data.expectedHappiness)} raw Happiness.`;
    case "EXPERIENCE_HAPPINESS_RESOLVED":
      return data.expectedHappiness === null || data.expectedHappiness === undefined
        ? `${name(data.characterId)} realized ${signed(data.rawDelta)} raw Happiness from experience ${data.eventId}.`
        : `${name(data.characterId)} realized ${signed(data.rawDelta)} raw Happiness from experience ${data.eventId}, ${signed(data.realizedMinusExpected)} versus the recorded expectation.`;
    case "INVITATION_SENT":
      return `${name(data.senderId)} invited ${name(data.targetId)} to ${data.destinationType === "event" ? `event ${data.eventId}` : location(data.locationId)}.`;
    case "INVITATION_ACCEPTED":
      return `${name(data.targetId)} accepted ${name(data.senderId)}'s invitation.`;
    case "INVITATION_DECLINED":
      return `${name(data.targetId)} declined ${name(data.senderId)}'s invitation.`;
    case "INVITATION_EXPIRED":
      return `${name(data.targetId)} did not answer ${name(data.senderId)}'s invitation before its deadline.`;
    case "COMMITMENT_CREATED":
      return `${data.participantIds.map(name).join(" and ")} committed to meet at ${location(data.locationId)}.`;
    case "COMMITMENT_REMINDER_SENT":
      return `${data.participantIds.map(name).join(" and ")} were reminded of their meeting at ${location(data.locationId)}.`;
    case "COMMITMENT_WINDOW_OPENED":
      return `The meeting window opened at ${location(data.locationId)}.`;
    case "COMMITMENT_KEPT":
      return `${data.participantIds.map(name).join(" and ")} kept their commitment at ${location(data.locationId)}.`;
    case "COMMITMENT_MISSED":
      return `${data.absentIds.map(name).join(" and ")} missed a commitment at ${location(data.locationId)}.`;
    case "ENERGY_CHANGED":
      return `${name(data.characterId)} used ${Math.abs(data.delta)} energy for ${humanize(data.reason)} (${data.value} remaining).`;
    case "REST_STARTED":
      return `${name(data.characterId)} started resting until ${shortTime(data.expectedEndAt)}.`;
    case "REST_COMPLETED":
      return `${name(data.characterId)} completed rest and recovered ${data.recoveredEnergy} energy.`;
    case "SECONDARY_GOAL_ADOPTED":
      return `${name(data.characterId)} adopted the secondary goal ${humanize(data.goal.type)}.`;
    case "SECONDARY_GOAL_COMPLETED":
      return `${name(data.characterId)} completed secondary goal ${data.goalId}.`;
    case "SECONDARY_GOAL_ABANDONED":
      return `${name(data.characterId)} abandoned secondary goal ${data.goalId}.`;
    case "SECONDARY_GOAL_EXPIRED":
      return `${name(data.characterId)}'s secondary goal ${data.goalId} expired.`;
    case "DECISION_RECORDED":
      return `${name(data.characterId)} decided: ${data.summary}`;
    case "VEHICLE_PURCHASED":
      return `${name(data.characterId)} bought a ${data.vehicleId} from the city for ${data.price} credits.`;
    case "COURSE_OFFERED":
      return `“${data.title}” went up on the ${location(data.boardLocationId)} board for ${data.price} credits.`;
    case "COURSE_ENROLLED":
      return `${name(data.characterId)} paid ${data.price} credits to enrol in “${data.title}”.`;
    case "COURSE_STARTED":
      return `${name(data.characterId)} started “${data.title}” at ${location(data.locationId)} until ${shortTime(data.expectedEndAt)}.`;
    case "COURSE_COMPLETED":
      return `${name(data.characterId)} completed “${data.title}”.`;
    case "COURSE_ABANDONED":
      return `${name(data.characterId)}'s enrolment ended (${humanize(data.cause)}); the ${data.feeForfeited}-credit tuition is forfeit.`;
    case "REPUTATION_CHANGED":
      return `${name(data.characterId)}'s reputation moved ${signed(data.delta)} to ${data.value} (${humanize(data.cause)}).`;
    case "DOMAIN_REPUTATION_CHANGED":
      return `${name(data.characterId)}'s ${data.domain} reputation moved ${signed(data.delta)} to ${data.value} (${humanize(data.cause)}).`;
    case "BUILDING_ROLE_APPLIED":
      return `${name(data.characterId)} applied for “${data.title}”.`;
    case "BUILDING_ROLE_APPLICATION_WITHDRAWN":
      return `${name(data.characterId)} withdrew from “${data.title}”.`;
    case "BUILDING_ROLE_FILLED":
      return `${name(data.characterId)} was selected for “${data.title}”.`;
    case "BUILDING_ROLE_CANDIDATE_REJECTED":
      return `${name(data.characterId)} was not selected for “${data.title}” (${humanize(data.cause)}).`;
    case "BUILDING_LIFECYCLE_WARNING":
      return `${data.name} risks becoming ${data.nextStatus} at ${data.transitionAt}; recovery costs ${data.recoveryCost} credits.`;
    case "BUILDING_DELINQUENT":
    case "BUILDING_INACTIVATED":
    case "BUILDING_REACTIVATED":
    case "BUILDING_CLOSED":
    case "BUILDING_ABANDONED":
      return `${data.name} changed from ${data.previousStatus} to ${data.status}; its history and existing obligations are preserved.`;
    default:
      return humanize(event.type);
  }
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function humanize(value) {
  return String(value).toLowerCase().replaceAll("_", " ");
}

function shortTime(value) {
  return new Date(value).toISOString().slice(11, 16);
}

import { EventEmitter } from "node:events";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { addGameMinutes } from "./clock.js";
import { buildTimeline } from "./timeline.js";

const relevanceOrder = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const ownerFeedTypes = new Set([
  "CHARACTER_CREATED", "MOVEMENT_STARTED", "CHARACTER_ARRIVED",
  "CO_PRESENCE_STARTED", "CO_PRESENCE_ENDED",
  "CONVERSATION_STARTED", "CONVERSATION_MESSAGE_SENT", "CONVERSATION_ENDED",
  "CONVERSATION_TURN_EXPIRED", "SILENCE_RESOLVED", "AGENT_REACTION_TIMED_OUT",
  "KNOWLEDGE_LEARNED", "RELATIONSHIP_CREATED", "RELATIONSHIP_CHANGED",
  "SECONDARY_GOAL_ADOPTED", "SECONDARY_GOAL_COMPLETED", "SECONDARY_GOAL_ABANDONED", "SECONDARY_GOAL_EXPIRED",
  "JOB_CREATED", "JOB_ACCEPTED", "JOB_STARTED", "JOB_COMPLETED", "JOB_CANCELLED", "JOB_FAILED", "JOB_EXPIRED",
  "EVENT_CREATED", "EVENT_ATTENDANCE_STARTED", "EVENT_ATTENDANCE_ENDED",
  "INVITATION_SENT", "INVITATION_ACCEPTED", "INVITATION_DECLINED", "INVITATION_EXPIRED",
  "COMMITMENT_CREATED", "COMMITMENT_REMINDER_SENT", "COMMITMENT_WINDOW_OPENED", "COMMITMENT_KEPT", "COMMITMENT_MISSED",
  "JOB_TEAM_MEMBER_JOINED", "JOB_TEAM_MEMBER_LEFT",
  "ENERGY_CHANGED", "REST_STARTED", "REST_COMPLETED", "DECISION_RECORDED",
  "DEADLINE_SUPPRESSED_FOR_PLATFORM_INCIDENT", "AGENT_RESPONSE_MISSED", "AGENT_RECOVERY_VERIFIED",
]);

const nonProjectionEventTypes = new Set([
  "AGENT_ACTION_PROCESSED", "RELEVANCE_EVALUATED", "OWNER_FEED_VIEWED",
  "RETURN_SUMMARY_VIEWED", "STORY_DETAIL_VIEWED", "STORY_INTEREST_RATED",
  "AGENT_EVENT_REPLAYED", "AGENT_CONNECTION_TESTED",
  "OPPORTUNITIES_VIEWED", "AGENT_RULES_REQUESTED",
]);

// A directional relationship is private to its owner, so only `fromId` projects it.
const directionalRelationshipEventTypes = new Set([
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

export class World {
  constructor({ store, clock, config, idGenerator = randomUUID }) {
    this.store = store;
    this.clock = clock;
    this.config = config;
    this.idGenerator = idGenerator;
    this.events = new EventEmitter();
    this.history = store.readAll();
    this.state = createEmptyState();
    for (const event of this.history) this.apply(event);
  }

  subscribe(listener) {
    this.events.on("event", listener);
    return () => this.events.off("event", listener);
  }

  issueAgentCredential(characterId, permissions = ["observe", "act", "events", "ack", "health"]) {
    this.requireCharacter(characterId);
    const allowedPermissions = new Set(["observe", "act", "events", "ack", "health"]);
    if (!Array.isArray(permissions) || permissions.length === 0
      || permissions.some((permission) => !allowedPermissions.has(permission))) {
      throw invalid("INVALID_AGENT_PERMISSIONS", "Agent credential permissions are invalid");
    }
    const credentialId = this.idGenerator();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const created = this.record("AGENT_CREDENTIAL_CREATED", {
      actorCharacterId: characterId,
      data: {
        credentialId, characterId, permissions: [...new Set(permissions)], tokenHash,
        createdAt: new Date().toISOString(),
      },
    });
    return {
      credentialId, characterId, permissions: [...new Set(permissions)],
      token, createdEventId: created.id,
    };
  }

  revokeAgentCredential(characterId, credentialId) {
    this.requireCharacter(characterId);
    const credential = this.state.agentCredentials.get(credentialId);
    if (!credential || credential.characterId !== characterId) throw new DomainError("AGENT_CREDENTIAL_NOT_FOUND", "Agent credential not found", 404);
    if (credential.revokedAt) return null;
    return this.record("AGENT_CREDENTIAL_REVOKED", {
      actorCharacterId: characterId,
      data: { credentialId, characterId, revokedAt: new Date().toISOString() },
    });
  }

  authenticateAgentCredential(characterId, token, permission) {
    if (typeof token !== "string" || !token) return false;
    const suppliedHash = createHash("sha256").update(token).digest();
    return [...this.state.agentCredentials.values()].some((credential) => {
      if (credential.characterId !== characterId || credential.revokedAt || !credential.permissions.includes(permission)) return false;
      const expectedHash = Buffer.from(credential.tokenHash, "hex");
      return expectedHash.length === suppliedHash.length && timingSafeEqual(expectedHash, suppliedHash);
    });
  }

  testAgentConnection(characterId, { clientVersion = null, protocolVersion = null, capabilities = [] } = {}) {
    this.requireCharacter(characterId);
    const problems = [];
    if (protocolVersion !== this.config.protocol.version) {
      problems.push({ code: "PROTOCOL_VERSION_MISMATCH", expected: this.config.protocol.version, received: protocolVersion });
    }
    if (!Array.isArray(capabilities)) {
      problems.push({ code: "INVALID_CAPABILITIES", required: this.config.protocol.minimumCapabilities });
    } else {
      const missing = this.config.protocol.minimumCapabilities.filter((capability) => !capabilities.includes(capability));
      if (missing.length > 0) problems.push({ code: "MISSING_CAPABILITIES", missing });
    }
    const compatible = problems.length === 0;
    const tested = this.record("AGENT_CONNECTION_TESTED", {
      actorCharacterId: characterId,
      data: {
        characterId, clientVersion: clientVersion ? String(clientVersion).slice(0, 100) : null,
        protocolVersion, declaredCapabilities: Array.isArray(capabilities) ? [...capabilities] : [],
        compatible, problems,
      },
    });
    if (compatible) this.verifyAgentRecovery(characterId);
    return {
      compatible, problems, eventId: tested.id, protocolVersion: this.config.protocol.version,
      rulesVersion: this.config.rules.version,
      rulesUrl: `/api/characters/${encodeURIComponent(characterId)}/rules`,
    };
  }

  registerAgentEventChannel(characterId, { channelId = this.idGenerator(), transport = "sse" } = {}) {
    this.requireCharacter(characterId);
    requiredId(channelId, "channel id");
    if (transport !== "sse") throw invalid("UNSUPPORTED_CHANNEL_TRANSPORT", "Only the authenticated SSE event channel is supported");
    const existing = [...this.state.agentEventChannels.values()].find((channel) =>
      channel.characterId === characterId && channel.status !== "disabled");
    if (existing) this.disableAgentEventChannel(characterId, existing.id, "replaced");
    const verificationToken = randomBytes(24).toString("base64url");
    const verificationTokenHash = createHash("sha256").update(verificationToken).digest("hex");
    const registered = this.record("AGENT_EVENT_CHANNEL_REGISTERED", {
      actorCharacterId: characterId,
      data: {
        channelId, characterId, transport, verificationTokenHash,
        registeredAt: new Date().toISOString(), status: "pending_verification",
      },
    });
    return { channelId, characterId, transport, verificationToken, eventId: registered.id };
  }

  verifyAgentEventChannel(characterId, channelId, verificationToken) {
    this.requireCharacter(characterId);
    const channel = this.state.agentEventChannels.get(channelId);
    if (!channel || channel.characterId !== characterId) throw new DomainError("AGENT_CHANNEL_NOT_FOUND", "Agent event channel not found", 404);
    if (channel.status === "disabled") throw conflict("AGENT_CHANNEL_DISABLED", "Agent event channel is disabled");
    if (channel.status === "verified") return null;
    const supplied = createHash("sha256").update(String(verificationToken ?? "")).digest();
    const expected = Buffer.from(channel.verificationTokenHash, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw forbidden("CHANNEL_VERIFICATION_FAILED", "Agent event channel verification failed");
    }
    return this.record("AGENT_EVENT_CHANNEL_VERIFIED", {
      actorCharacterId: characterId,
      causedByEventIds: [channel.registeredByEventId],
      data: { channelId, characterId, verifiedAt: new Date().toISOString() },
    });
  }

  disableAgentEventChannel(characterId, channelId, reason = "owner_disabled") {
    this.requireCharacter(characterId);
    const channel = this.state.agentEventChannels.get(channelId);
    if (!channel || channel.characterId !== characterId) throw new DomainError("AGENT_CHANNEL_NOT_FOUND", "Agent event channel not found", 404);
    if (channel.status === "disabled") return null;
    return this.record("AGENT_EVENT_CHANNEL_DISABLED", {
      actorCharacterId: characterId,
      data: { channelId, characterId, disabledAt: new Date().toISOString(), reason },
    });
  }

  hasVerifiedAgentEventChannel(characterId) {
    return [...this.state.agentEventChannels.values()].some((channel) =>
      channel.characterId === characterId && channel.status === "verified");
  }

  hasConfiguredAgentEventChannel(characterId) {
    return [...this.state.agentEventChannels.values()].some((channel) => channel.characterId === characterId);
  }

  recordAgentEventReplay(characterId, notificationEventId) {
    return this.record("AGENT_EVENT_REPLAYED", {
      actorCharacterId: characterId,
      causedByEventIds: [notificationEventId],
      data: { characterId, notificationEventId, cursor: this.history.find((event) => event.id === notificationEventId)?.sequence },
    });
  }

  defineLocation({ id, name }) {
    requiredId(id, "location id");
    requiredText(name, "location name", 80);
    if (this.state.locations.has(id)) throw conflict("LOCATION_EXISTS", `Location ${id} already exists`);
    return this.record("LOCATION_DEFINED", { data: { id, name } });
  }

  activateWorldConfiguration({ version, schemaVersion = 1 }) {
    requiredId(version, "world configuration version");
    if (this.state.activeWorldConfigurationVersion) throw conflict("WORLD_CONFIGURATION_ACTIVE", "A world configuration is already active");
    return this.record("WORLD_CONFIGURATION_ACTIVATED", {
      data: { version, schemaVersion, activatedAt: this.clock.now().toISOString() },
    });
  }

  defineConnection({ fromLocationId, toLocationId, durationGameMinutes, bidirectional = false }) {
    this.requireLocation(fromLocationId);
    this.requireLocation(toLocationId);
    if (fromLocationId === toLocationId) throw invalid("INVALID_CONNECTION", "A location cannot connect to itself");
    if (!Number.isFinite(durationGameMinutes) || durationGameMinutes <= 0) throw invalid("INVALID_DURATION", "Connection duration must be positive");
    const connections = [{ fromLocationId, toLocationId }];
    if (bidirectional) connections.push({ fromLocationId: toLocationId, toLocationId: fromLocationId });
    const created = [];
    for (const connection of connections) {
      const key = `${connection.fromLocationId}->${connection.toLocationId}`;
      if (this.state.connections.has(key)) throw conflict("CONNECTION_EXISTS", `Connection ${key} already exists`);
      created.push(this.record("LOCATION_CONNECTION_DEFINED", {
        data: { ...connection, durationGameMinutes },
      }));
    }
    return created[0];
  }

  createCharacter({
    id,
    name,
    locationId,
    personality = [],
    goal = "",
    primaryGoal = null,
    energy = this.config.energy.maximum,
    credits = 0,
    skills = { social: 0, business: 0, creativity: 0, technical: 0 },
  }) {
    requiredId(id, "character id");
    requiredText(name, "character name", 80);
    this.requireLocation(locationId);
    if (this.state.characters.has(id)) throw conflict("CHARACTER_EXISTS", `Character ${id} already exists`);
    if (!Array.isArray(personality) || personality.length > 12) throw invalid("INVALID_PERSONALITY", "Personality must contain at most 12 traits");
    if (!Number.isFinite(energy) || energy < 0 || energy > this.config.energy.maximum) throw invalid("INVALID_ENERGY", "Invalid starting energy");
    if (!Number.isFinite(credits) || credits < 0) throw invalid("INVALID_CREDITS", "Invalid starting credits");

    const created = this.record("CHARACTER_CREATED", {
      actorCharacterId: id,
      data: {
        id,
        name,
        locationId,
        personality: personality.map((trait) => String(trait).slice(0, 80)),
        goal: String(goal).slice(0, 500),
        primaryGoal: primaryGoal ? normalizeGoal(primaryGoal, { id: `primary-${id}`, className: "primary" }) : null,
        energy,
        credits,
        skills: normalizeSkills(skills),
      },
    });
    for (const other of this.state.characters.values()) {
      if (other.id !== id && other.locationId === locationId && other.activity?.type !== "moving") {
        this.startCoPresence(id, other.id, locationId, created.id);
      }
    }
    return created;
  }

  establishRelationship({ fromId, toId, value = 0, affinity = value, trust = 0, tension = 0, reason = "existing_history" }) {
    this.requireCharacter(fromId);
    this.requireCharacter(toId);
    if (fromId === toId) throw invalid("SELF_RELATIONSHIP", "A character cannot have a relationship with itself");
    if (this.state.relationships.has(relationshipKey(fromId, toId))) {
      throw conflict("RELATIONSHIP_EXISTS", "Initial relationship is already established");
    }
    const dimensions = normalizeRelationship({ affinity, trust, tension }, this.config.relationship);
    return this.record("RELATIONSHIP_CREATED", {
      actorCharacterId: fromId,
      subjectCharacterId: toId,
      data: { fromId, toId, ...dimensions, reason, relationshipRuleVersion: this.config.relationship.policyVersion },
    });
  }

  startMove(characterId, destinationId) {
    const character = this.requireCharacter(characterId);
    this.requireLocation(destinationId);
    if (character.locationId === destinationId) throw invalid("ALREADY_THERE", "Character is already at that location");
    if (character.activity) throw conflict("ACTIVITY_CONFLICT", `Cannot move while ${character.activity.type}`);
    this.requireEnergy(character, this.config.energy.movementCost);

    const configuredConnections = [...this.state.connections.values()];
    const connection = this.state.connections.get(`${character.locationId}->${destinationId}`);
    if (configuredConnections.length > 0 && !connection) throw invalid("UNREACHABLE_DESTINATION", "Destination is not reachable from the current location");
    const durationGameMinutes = connection?.durationGameMinutes ?? this.config.movement.durationGameMinutes;
    const energyEvent = this.changeEnergy(characterId, -this.config.energy.movementCost, "movement");
    const expectedEndAt = addGameMinutes(this.clock.now(), durationGameMinutes).toISOString();
    const movement = this.record("MOVEMENT_STARTED", {
      actorCharacterId: characterId,
      causedByEventIds: [energyEvent.id],
      data: {
        characterId,
        fromLocationId: character.locationId,
        destinationId,
        durationGameMinutes,
        startedAt: this.clock.now().toISOString(),
        expectedEndAt,
      },
    });
    this.endCoPresenceForCharacter(characterId, movement.id);
    this.endActiveConversations(characterId, "departure", movement.id);
    return movement;
  }

  createJob({ creatorId, id = this.idGenerator(), title, locationId, durationGameMinutes, compensation, requirements = {}, teamSize = 1, availableFrom, availableUntil, scheduledStartAt, offerExpiresAt }) {
    const creator = this.requireCharacter(creatorId);
    return this.publishJob({
      id, creatorId, fundingSourceType: "character", fundingSourceId: creatorId,
      title, locationId, durationGameMinutes, compensation, requirements, teamSize,
      scheduledStartAt: scheduledStartAt ?? availableFrom,
      offerExpiresAt: offerExpiresAt ?? availableUntil,
      availableCredits: creator.credits,
      visibility: "public",
    });
  }

  bootstrapEconomy({ budgetId = this.config.economy.bootstrapBudgetId, credits = this.config.economy.bootstrapCredits } = {}) {
    requiredId(budgetId, "budget id");
    if (this.state.systemBudgets.has(budgetId)) return null;
    if (!Number.isFinite(credits) || credits < 0) throw invalid("INVALID_CREDITS", "Bootstrap credits must be non-negative");
    return this.record("ECONOMY_BOOTSTRAPPED", {
      data: { budgetId, credits, currency: this.config.jobs.currency },
    });
  }

  createSystemJob({ budgetId = this.config.economy.bootstrapBudgetId, id = this.idGenerator(), title, locationId, durationGameMinutes, compensation, requirements = {}, teamSize = 1, scheduledStartAt, offerExpiresAt }) {
    const budget = this.state.systemBudgets.get(budgetId);
    if (!budget) throw new DomainError("BUDGET_NOT_FOUND", `System budget ${budgetId} not found`, 404);
    const openSystemJobs = [...this.state.jobs.values()].filter((job) =>
      job.fundingSourceType === "system_budget" && ["open", "accepted", "running"].includes(job.status)).length;
    if (openSystemJobs >= this.config.economy.maximumOpenSystemJobs) {
      throw conflict("SYSTEM_JOB_LIMIT", "The maximum number of active system-funded jobs has been reached");
    }
    return this.publishJob({
      id, creatorId: null, fundingSourceType: "system_budget", fundingSourceId: budgetId,
      title, locationId, durationGameMinutes, compensation, requirements, teamSize,
      scheduledStartAt, offerExpiresAt, availableCredits: budget.balance,
      visibility: "public",
    });
  }

  publishJob({ id, creatorId, fundingSourceType, fundingSourceId, title, locationId, durationGameMinutes, compensation, requirements, teamSize = 1, scheduledStartAt, offerExpiresAt, availableCredits, visibility }) {
    this.requireLocation(locationId);
    requiredText(title, "job title", 120);
    if (!Number.isFinite(compensation) || compensation <= 0) throw invalid("INVALID_COMPENSATION", "Compensation must be positive");
    if (availableCredits < compensation) throw invalid("INSUFFICIENT_CREDITS", "Funding source cannot fund job escrow");
    if (!Number.isFinite(durationGameMinutes) || durationGameMinutes <= 0) throw invalid("INVALID_DURATION", "Job duration must be positive");
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 5) throw invalid("INVALID_TEAM_SIZE", "Team size must be between 1 and 5");
    if (this.state.jobs.has(id)) throw conflict("JOB_EXISTS", `Job ${id} already exists`);
    const publishedAt = this.clock.now();
    const start = new Date(scheduledStartAt ?? publishedAt);
    const expires = new Date(offerExpiresAt ?? addGameMinutes(publishedAt, this.config.jobs.defaultOfferDurationWorldHours * 60));
    if (Number.isNaN(start.getTime()) || !(expires > publishedAt)) throw invalid("INVALID_WINDOW", "Job timing is invalid");
    const startGraceUntil = addGameMinutes(start, this.config.jobs.startGraceWorldHours * 60);
    const reservationId = this.idGenerator();

    const created = this.record("JOB_CREATED", {
      actorCharacterId: creatorId,
      data: {
        id,
        creatorId,
        fundingSourceType,
        fundingSourceId,
        title,
        locationId,
        durationGameMinutes,
        compensation,
        requirements: normalizeSkills(requirements),
        teamSize,
        requirementsMode: teamSize > 1 ? "team_coverage" : "individual",
        visibility,
        publishedAt: publishedAt.toISOString(),
        scheduledStartAt: start.toISOString(),
        startGraceUntil: startGraceUntil.toISOString(),
        offerExpiresAt: expires.toISOString(),
        availableFrom: start.toISOString(),
        availableUntil: expires.toISOString(),
        reservation: {
          id: reservationId,
          amount: compensation,
          currency: this.config.jobs.currency,
          originalFundingSource: { type: fundingSourceType, id: fundingSourceId },
          createdAt: publishedAt.toISOString(),
          expiresAt: expires.toISOString(),
          policyVersion: this.config.jobs.escrowPolicyVersion,
          state: "reserved",
        },
      },
    });
    this.record("JOB_ESCROW_RESERVED", {
      actorCharacterId: creatorId,
      causedByEventIds: [created.id],
      data: {
        jobId: id, reservationId, amount: compensation,
        currency: this.config.jobs.currency, fundingSourceType, fundingSourceId,
        expiresAt: expires.toISOString(), escrowPolicyVersion: this.config.jobs.escrowPolicyVersion,
      },
    });
    return created;
  }

  acceptJob(workerId, jobId) {
    const worker = this.requireCharacter(workerId);
    const job = this.requireJob(jobId);
    if (job.status !== "open") throw conflict("JOB_UNAVAILABLE", "Job is not open");
    if (job.creatorId === workerId) throw conflict("SELF_EMPLOYMENT", "A character cannot accept its own funded job");
    if (worker.agentAvailability === "unavailable") throw conflict("AGENT_UNAVAILABLE", "Unavailable agents cannot accept new jobs");
    if (worker.activity) throw conflict("ACTIVITY_CONFLICT", `Cannot accept a job while ${worker.activity.type}`);
    if (worker.locationId !== job.locationId) throw invalid("WRONG_LOCATION", "Character must be at the job location to accept it");
    if (job.workerIds.includes(workerId)) throw conflict("ALREADY_JOINED_TEAM", "Character already joined this job");
    const existingCommitment = [...this.state.jobs.values()].find((candidate) =>
      candidate.workerIds?.includes(workerId) && (candidate.status !== "open" || candidate.workerIds.length > 0));
    if (existingCommitment) throw conflict("JOB_COMMITMENT_CONFLICT", `Character is already committed to job ${existingCommitment.id}`);
    if (this.clock.now() >= new Date(job.offerExpiresAt)) {
      this.expireJobOffer(job.id, job.offerExpiresAt);
      throw conflict("JOB_OFFER_EXPIRED", "The job offer has expired");
    }
    if (this.clock.now() > new Date(job.startGraceUntil)) throw conflict("START_WINDOW_CLOSED", "The disclosed start window has closed");
    if (job.teamSize === 1) {
      for (const [skill, required] of Object.entries(job.requirements)) {
        if ((worker.skills[skill] ?? 0) < required) throw invalid("SKILL_REQUIREMENT", `${skill} must be at least ${required}`);
      }
      return this.record("JOB_ACCEPTED", {
        actorCharacterId: workerId,
        subjectCharacterId: job.creatorId,
        data: {
          jobId, workerId, workerIds: [workerId], title: job.title, locationId: job.locationId,
          acceptedAt: this.clock.now().toISOString(), scheduledStartAt: job.scheduledStartAt,
          startGraceUntil: job.startGraceUntil, reservationId: job.reservation.id,
        },
      });
    }
    if (job.workerIds.length >= job.teamSize) throw conflict("TEAM_FULL", "The job team is already full");
    const prospectiveWorkerIds = [...job.workerIds, workerId];
    if (prospectiveWorkerIds.length === job.teamSize) {
      const uncovered = this.teamRequirementGaps(job, prospectiveWorkerIds);
      if (uncovered.length > 0) {
        throw invalid("TEAM_SKILL_COVERAGE", "The completed team would not cover every requirement", { uncovered });
      }
    }
    const joined = this.record("JOB_TEAM_MEMBER_JOINED", {
      actorCharacterId: workerId,
      subjectCharacterId: job.creatorId,
      data: {
        jobId, workerId, workerIds: prospectiveWorkerIds, teamSize: job.teamSize,
        title: job.title, locationId: job.locationId, joinedAt: this.clock.now().toISOString(),
      },
    });
    if (prospectiveWorkerIds.length < job.teamSize) return joined;
    return this.record("JOB_ACCEPTED", {
      actorCharacterId: workerId,
      subjectCharacterId: job.creatorId,
      causedByEventIds: [joined.id],
      data: {
        jobId, workerId, workerIds: prospectiveWorkerIds, title: job.title, locationId: job.locationId,
        acceptedAt: this.clock.now().toISOString(), scheduledStartAt: job.scheduledStartAt,
        startGraceUntil: job.startGraceUntil, reservationId: job.reservation.id,
      },
    });
  }

  startJob(workerId, jobId) {
    const worker = this.requireCharacter(workerId);
    if (worker.agentAvailability === "unavailable") throw conflict("AGENT_UNAVAILABLE", "Unavailable agents cannot start new jobs");
    const job = this.requireJob(jobId);
    if (job.status !== "accepted" || !job.workerIds.includes(workerId)) throw conflict("JOB_NOT_ASSIGNED", "Job is not assigned to this character");
    const workers = job.workerIds.map((id) => this.requireCharacter(id));
    const unavailableWorker = workers.find((candidate) => candidate.agentAvailability === "unavailable");
    if (unavailableWorker) throw conflict("TEAM_MEMBER_UNAVAILABLE", `${unavailableWorker.name} is unavailable`);
    const busyWorker = workers.find((candidate) => candidate.activity);
    if (busyWorker) throw conflict("ACTIVITY_CONFLICT", `${busyWorker.name} cannot start while ${busyWorker.activity.type}`);
    const absentWorker = workers.find((candidate) => candidate.locationId !== job.locationId);
    if (absentWorker) throw invalid("TEAM_NOT_COLOCATED", `${absentWorker.name} must be at the job location`);
    const now = this.clock.now();
    if (now < new Date(job.scheduledStartAt) || now > new Date(job.startGraceUntil)) throw invalid("OUTSIDE_JOB_WINDOW", "Job cannot start outside its disclosed start window");
    for (const candidate of workers) this.requireEnergy(candidate, this.config.energy.workCost);

    const energyEvents = workers.map((candidate) => this.changeEnergy(candidate.id, -this.config.energy.workCost, "work"));
    const expectedEndAt = addGameMinutes(now, job.durationGameMinutes).toISOString();
    return this.record("JOB_STARTED", {
      actorCharacterId: workerId,
      subjectCharacterId: job.creatorId,
      causedByEventIds: energyEvents.map((event) => event.id),
      data: {
        jobId,
        workerId, workerIds: job.workerIds,
        title: job.title,
        locationId: job.locationId,
        startedAt: now.toISOString(),
        expectedEndAt,
        reservationId: job.reservation.id,
      },
    });
  }

  teamRequirementGaps(job, workerIds) {
    return Object.entries(job.requirements)
      .filter(([, required]) => required > 0)
      .map(([skill, required]) => ({
        skill, required,
        actual: Math.max(0, ...workerIds.map((id) => this.requireCharacter(id).skills[skill] ?? 0)),
      }))
      .filter((item) => item.actual < item.required);
  }

  cancelJob(actorCharacterId, jobId) {
    const actor = this.requireCharacter(actorCharacterId);
    const job = this.requireJob(jobId);
    if (!["open", "accepted", "running"].includes(job.status)) throw conflict("JOB_TERMINAL", "The job is already terminal");
    const isFunder = job.fundingSourceType === "character" && job.fundingSourceId === actor.id;
    const isWorker = job.workerIds.includes(actor.id);
    if (!isFunder && !isWorker) throw forbidden("NOT_JOB_PARTY", "Only the funding character or assigned worker can cancel this job");
    if (isFunder && job.status === "running") throw conflict("FUNDER_CANNOT_CANCEL_RUNNING_JOB", "The funder cannot cancel after work starts");
    if (isWorker && job.status === "open") {
      const workerIds = job.workerIds.filter((id) => id !== actor.id);
      return this.record("JOB_TEAM_MEMBER_LEFT", {
        actorCharacterId: actor.id,
        subjectCharacterId: job.creatorId,
        data: { jobId: job.id, workerId: actor.id, workerIds, terminalStatus: "open", reason: "withdrew_before_team_formed" },
      });
    }

    let terminalCause;
    let terminalStatus = "cancelled";
    let workerShare = 0;
    if (isFunder && job.status === "open") terminalCause = "funder_cancelled_before_acceptance";
    else if (isFunder && job.status === "accepted") {
      terminalCause = "funder_cancelled_after_acceptance";
      workerShare = this.config.jobs.employerCancellationWorkerShare;
    } else if (isWorker && job.status === "accepted") terminalCause = "worker_cancelled_before_start";
    else {
      terminalCause = "worker_abandoned_after_start";
      terminalStatus = "failed";
    }
    return this.finalizeJob(job, {
      terminalStatus, terminalCause, workerShare,
      actorCharacterId, worldTime: this.clock.now().toISOString(),
    });
  }

  expireJobOffer(jobId, worldTime) {
    const job = this.requireJob(jobId);
    if (job.status !== "open") return null;
    return this.finalizeJob(job, {
      terminalStatus: "expired", terminalCause: "offer_expired",
      workerShare: 0, actorCharacterId: null, worldTime,
    });
  }

  failJobForNoShow(jobId, worldTime) {
    const job = this.requireJob(jobId);
    if (job.status !== "accepted") return null;
    return this.finalizeJob(job, {
      terminalStatus: "failed", terminalCause: "worker_no_show",
      workerShare: 0, actorCharacterId: job.workerId, worldTime,
    });
  }

  finalizeJob(job, { terminalStatus, terminalCause, workerShare, actorCharacterId, worldTime }) {
    const workerAmount = Math.round(job.compensation * workerShare);
    const payoutWorkerIds = job.workerIds.length > 0 ? job.workerIds : [job.workerId].filter(Boolean);
    const basePayout = payoutWorkerIds.length > 0 ? Math.floor(workerAmount / payoutWorkerIds.length) : 0;
    const payoutRemainder = workerAmount - basePayout * payoutWorkerIds.length;
    const payouts = payoutWorkerIds.map((workerId, index) => ({
      workerId, amount: basePayout + (index === 0 ? payoutRemainder : 0),
    })).filter((payout) => payout.amount > 0);
    const refundAmount = job.compensation - workerAmount;
    const type = terminalStatus === "expired" ? "JOB_EXPIRED" : terminalStatus === "failed" ? "JOB_FAILED" : "JOB_CANCELLED";
    const terminal = this.record(type, {
      actorCharacterId,
      subjectCharacterId: job.creatorId,
      worldTime,
      data: {
        jobId: job.id, workerId: actorCharacterId && job.workerIds.includes(actorCharacterId) ? actorCharacterId : job.workerId,
        workerIds: job.workerIds, payouts, creatorId: job.creatorId,
        terminalStatus, terminalCause, workerAmount, refundAmount,
        reservationId: job.reservation.id, escrowPolicyVersion: job.reservation.policyVersion,
        processingDelayWorldMilliseconds: Math.max(0, this.clock.now() - new Date(worldTime)),
      },
    });
    const escrowType = workerAmount > 0 ? "JOB_ESCROW_SPLIT" : "JOB_ESCROW_REFUNDED";
    this.record(escrowType, {
      actorCharacterId,
      subjectCharacterId: job.workerId,
      causedByEventIds: [terminal.id],
      worldTime,
      data: {
        jobId: job.id, reservationId: job.reservation.id, workerAmount, payouts, refundAmount,
        currency: job.reservation.currency, terminalCause,
      },
    });
    return terminal;
  }

  startRest(characterId) {
    const character = this.requireCharacter(characterId);
    if (character.activity) throw conflict("ACTIVITY_CONFLICT", `Cannot rest while ${character.activity.type}`);
    if (character.energy >= this.config.energy.maximum) throw conflict("ENERGY_FULL", "Character energy is already full");
    const startedAt = this.clock.now();
    const expectedEndAt = addGameMinutes(startedAt, this.config.energy.restDurationGameMinutes).toISOString();
    const rest = this.record("REST_STARTED", {
      actorCharacterId: characterId,
      data: {
        characterId, startedAt: startedAt.toISOString(), expectedEndAt,
        expectedRecovery: Math.min(this.config.energy.restRecovery, this.config.energy.maximum - character.energy),
      },
    });
    this.endActiveConversations(characterId, "incompatible_activity", rest.id);
    return rest;
  }

  createEvent({ creatorId = null, id = this.idGenerator(), title, locationId, startsAt, endsAt }) {
    if (creatorId) this.requireCharacter(creatorId);
    this.requireLocation(locationId);
    requiredText(title, "event title", 120);
    if (this.state.gatherings.has(id)) throw conflict("EVENT_EXISTS", `Event ${id} already exists`);
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!(end > start)) throw invalid("INVALID_WINDOW", "Event time window is invalid");
    return this.record("EVENT_CREATED", {
      actorCharacterId: creatorId,
      data: { id, creatorId, title, locationId, startsAt: start.toISOString(), endsAt: end.toISOString() },
    });
  }

  attendEvent(characterId, eventId) {
    const character = this.requireCharacter(characterId);
    const gathering = this.requireGathering(eventId);
    if (character.activity) throw conflict("ACTIVITY_CONFLICT", `Cannot attend while ${character.activity.type}`);
    if (character.locationId !== gathering.locationId) throw invalid("WRONG_LOCATION", "Character must be at the event location");
    const now = this.clock.now();
    if (now < new Date(gathering.startsAt) || now >= new Date(gathering.endsAt)) throw invalid("EVENT_NOT_ACTIVE", "Event is not active");
    this.requireEnergy(character, this.config.energy.eventAttendanceCost);
    const energyEvent = this.changeEnergy(characterId, -this.config.energy.eventAttendanceCost, "event_attendance");
    return this.record("EVENT_ATTENDANCE_STARTED", {
      actorCharacterId: characterId,
      causedByEventIds: [energyEvent.id],
      data: {
        eventId,
        characterId,
        title: gathering.title,
        locationId: gathering.locationId,
        startedAt: now.toISOString(),
        expectedEndAt: gathering.endsAt,
      },
    });
  }

  sendInvitation(senderId, targetId, { destinationType, destinationId, message }) {
    const sender = this.requireCharacter(senderId);
    const target = this.requireCharacter(targetId);
    if (senderId === targetId) throw invalid("SELF_INVITATION", "A character cannot invite itself");
    if (!this.getRelationship(senderId, targetId) && sender.locationId !== target.locationId) {
      throw forbidden("UNKNOWN_INVITATION_TARGET", "Invitations require an existing relationship or co-presence");
    }
    requiredText(message, "invitation message", this.config.conversation.maximumMessageCharacters);
    const openCount = [...this.state.invitations.values()].filter((invitation) =>
      invitation.senderId === senderId && ["pending", "accepted"].includes(invitation.status)).length;
    if (openCount >= this.config.invitations.maximumOpenPerCharacter) {
      throw conflict("INVITATION_LIMIT", "Character has too many open invitations");
    }
    let locationId;
    let eventId = null;
    let startsAt;
    let endsAt;
    if (destinationType === "event") {
      const gathering = this.requireGathering(destinationId);
      if (new Date(gathering.endsAt) <= this.clock.now()) throw conflict("EVENT_ENDED", "Cannot invite someone to an ended event");
      eventId = gathering.id;
      locationId = gathering.locationId;
      startsAt = new Date(Math.max(this.clock.now().getTime(), new Date(gathering.startsAt).getTime())).toISOString();
      endsAt = gathering.endsAt;
    } else if (destinationType === "location") {
      this.requireLocation(destinationId);
      locationId = destinationId;
      startsAt = addGameMinutes(this.clock.now(), this.config.invitations.locationLeadWorldMinutes).toISOString();
      endsAt = addGameMinutes(new Date(startsAt), this.config.invitations.locationWindowWorldMinutes).toISOString();
    } else {
      throw invalid("INVALID_INVITATION_DESTINATION", "Invitation destination must be a location or event");
    }
    const invitationId = this.idGenerator();
    const invitation = this.record("INVITATION_SENT", {
      actorCharacterId: senderId,
      subjectCharacterId: targetId,
      data: {
        invitationId, senderId, targetId, participantIds: [senderId, targetId],
        destinationType, destinationId, locationId, eventId, startsAt, endsAt, message,
        sentAt: this.clock.now().toISOString(), policyVersion: this.config.invitations.policyVersion,
      },
    });
    this.record("AGENT_NOTIFICATION_QUEUED", {
      actorCharacterId: senderId,
      subjectCharacterId: targetId,
      causedByEventIds: [invitation.id],
      data: {
        characterId: targetId, sourceEventId: invitation.id, invitationId,
        level: "HIGH", urgency: "normal",
        summary: `${sender.name} invited you to ${destinationType === "event" ? this.requireGathering(eventId).title : this.requireLocation(locationId).name}.`,
        requestKind: "invitation_response", compatibleActions: ["respond_invitation"],
        timingPolicyVersion: this.config.timing.policyVersion,
      },
    });
    return invitation;
  }

  respondToInvitation(characterId, invitationId, response) {
    const invitation = this.requireInvitation(invitationId);
    if (invitation.targetId !== characterId) throw forbidden("NOT_INVITATION_TARGET", "Only the invited character may respond");
    if (invitation.status !== "pending") throw conflict("INVITATION_RESOLVED", "Invitation already has a response");
    if (!["accept", "decline"].includes(response)) throw invalid("INVALID_INVITATION_RESPONSE", "Response must be accept or decline");
    const notificationEntry = [...this.state.notifications.entries()].find(([, notification]) =>
      notification.characterId === characterId && notification.invitationId === invitationId && !isNotificationTerminal(notification.status));
    if (notificationEntry) this.ensureNotificationWindowOpen(notificationEntry[0], notificationEntry[1]);
    if (response === "accept") {
      const conflicts = invitation.participantIds.flatMap((participantId) =>
        this.invitationCommitmentConflicts(participantId, invitation));
      if (conflicts.length > 0) {
        throw new DomainError("INVITATION_COMMITMENT_CONFLICT", "The invitation conflicts with a known commitment", 409, { conflicts });
      }
    }
    const type = response === "accept" ? "INVITATION_ACCEPTED" : "INVITATION_DECLINED";
    const responseEvent = this.record(type, {
      actorCharacterId: characterId,
      subjectCharacterId: invitation.senderId,
      causedByEventIds: [invitation.sentByEventId],
      data: {
        invitationId, senderId: invitation.senderId, targetId: characterId,
        participantIds: [...invitation.participantIds], response, respondedAt: this.clock.now().toISOString(),
      },
    });
    if (notificationEntry) this.resolveNotification(notificationEntry[0], "resolved", responseEvent.id, response);
    if (response === "decline") return responseEvent;
    const commitmentId = this.idGenerator();
    const reminderLeadWorldMinutes = Math.max(
      this.config.invitations.reminderWorldMinutes,
      ...invitation.participantIds.map((id) => this.minimumTravelWorldMinutes(
        this.requireCharacter(id).locationId, invitation.locationId,
      )),
    );
    const commitment = this.record("COMMITMENT_CREATED", {
      actorCharacterId: invitation.senderId,
      subjectCharacterId: invitation.targetId,
      causedByEventIds: [responseEvent.id, invitation.sentByEventId],
      data: {
        commitmentId, invitationId, participantIds: [...invitation.participantIds],
        destinationType: invitation.destinationType, destinationId: invitation.destinationId,
        locationId: invitation.locationId, eventId: invitation.eventId,
        startsAt: invitation.startsAt, endsAt: invitation.endsAt,
        reminderLeadWorldMinutes,
        reminderAt: new Date(Math.max(
          this.clock.now().getTime(),
          addGameMinutes(new Date(invitation.startsAt), -reminderLeadWorldMinutes).getTime(),
        )).toISOString(),
        status: "scheduled", policyVersion: this.config.invitations.policyVersion,
      },
    });
    return commitment;
  }

  invitationCommitmentConflicts(characterId, invitation) {
    const conflicts = [];
    const character = this.requireCharacter(characterId);
    if (character.activity?.expectedEndAt
      && new Date(character.activity.expectedEndAt) > new Date(invitation.startsAt)
      && !(character.activity.type === "attend_event" && character.activity.eventId === invitation.eventId)
      && !(character.activity.type === "work" && character.locationId === invitation.locationId)) {
      conflicts.push({ characterId, type: "activity", activityType: character.activity.type, expectedEndAt: character.activity.expectedEndAt });
    }
    for (const commitment of this.state.commitments.values()) {
      if (!["scheduled", "active"].includes(commitment.status) || !commitment.participantIds.includes(characterId)) continue;
      if (timeWindowsOverlap(invitation.startsAt, invitation.endsAt, commitment.startsAt, commitment.endsAt)) {
        conflicts.push({ characterId, type: "commitment", commitmentId: commitment.id });
      }
    }
    for (const job of this.state.jobs.values()) {
      if (!["accepted", "running"].includes(job.status) || !job.workerIds.includes(characterId)) continue;
      const startsAt = job.status === "running" ? character.activity?.startedAt : job.scheduledStartAt;
      const endsAt = job.status === "running"
        ? character.activity?.expectedEndAt
        : addGameMinutes(new Date(job.scheduledStartAt), job.durationGameMinutes).toISOString();
      if (job.locationId !== invitation.locationId && startsAt && endsAt
        && timeWindowsOverlap(invitation.startsAt, invitation.endsAt, startsAt, endsAt)) {
        conflicts.push({ characterId, type: "job", jobId: job.id });
      }
    }
    return conflicts;
  }

  openCommitmentWindow(commitmentId, worldTime) {
    const commitment = this.requireCommitment(commitmentId);
    if (commitment.status !== "scheduled") return null;
    const opened = this.record("COMMITMENT_WINDOW_OPENED", {
      actorCharacterId: commitment.participantIds[0], subjectCharacterId: commitment.participantIds[1],
      causedByEventIds: [commitment.createdByEventId], worldTime,
      data: { commitmentId, participantIds: [...commitment.participantIds], locationId: commitment.locationId },
    });
    return this.evaluateCommitmentPresence(commitmentId, worldTime, opened.id) ?? opened;
  }

  evaluateCommitmentPresence(commitmentId, worldTime = this.clock.now(), causedByEventId = null) {
    const commitment = this.requireCommitment(commitmentId);
    if (!['scheduled', 'active'].includes(commitment.status)) return null;
    const at = new Date(worldTime);
    if (at < new Date(commitment.startsAt) || at > new Date(commitment.endsAt)) return null;
    const presentIds = commitment.participantIds.filter((id) => {
      const character = this.requireCharacter(id);
      return character.locationId === commitment.locationId && character.activity?.type !== "moving";
    });
    if (presentIds.length !== commitment.participantIds.length) return null;
    const kept = this.record("COMMITMENT_KEPT", {
      actorCharacterId: commitment.participantIds[0], subjectCharacterId: commitment.participantIds[1],
      causedByEventIds: [causedByEventId, commitment.createdByEventId].filter(Boolean), worldTime: at,
      data: {
        commitmentId, invitationId: commitment.invitationId,
        participantIds: [...commitment.participantIds], presentIds,
        locationId: commitment.locationId, eventId: commitment.eventId,
      },
    });
    for (const fromId of commitment.participantIds) {
      const toId = commitment.participantIds.find((id) => id !== fromId);
      this.applyRelationshipRule("promise_kept", { fromId, toId, causedByEventIds: [kept.id] });
    }
    this.resolveCommitmentNotifications(commitment.id, kept.id, "commitment_kept");
    return kept;
  }

  missCommitment(commitmentId, worldTime) {
    const commitment = this.requireCommitment(commitmentId);
    if (!['scheduled', 'active'].includes(commitment.status)) return null;
    const presentIds = commitment.participantIds.filter((id) => {
      const character = this.requireCharacter(id);
      return character.locationId === commitment.locationId && character.activity?.type !== "moving";
    });
    const absentIds = commitment.participantIds.filter((id) => !presentIds.includes(id));
    const missed = this.record("COMMITMENT_MISSED", {
      actorCharacterId: absentIds[0] ?? null,
      subjectCharacterId: presentIds[0] ?? absentIds[1] ?? null,
      causedByEventIds: [commitment.createdByEventId], worldTime,
      data: {
        commitmentId, invitationId: commitment.invitationId,
        participantIds: [...commitment.participantIds], presentIds, absentIds,
        locationId: commitment.locationId, eventId: commitment.eventId,
      },
    });
    for (const observerId of commitment.participantIds) {
      const otherId = commitment.participantIds.find((id) => id !== observerId);
      if (absentIds.includes(otherId)) {
        this.applyRelationshipRule("promise_broken", { fromId: observerId, toId: otherId, causedByEventIds: [missed.id] });
      }
    }
    this.resolveCommitmentNotifications(commitment.id, missed.id, "commitment_missed");
    return missed;
  }

  resolveCommitmentNotifications(commitmentId, resolutionEventId, outcome) {
    for (const [notificationEventId, notification] of this.state.notifications.entries()) {
      if (notification.commitmentId === commitmentId && !isNotificationTerminal(notification.status)) {
        this.resolveNotification(notificationEventId, "resolved", resolutionEventId, outcome);
      }
    }
  }

  startConversation(initiatorId, targetId, openingMessage = "") {
    const initiator = this.requireCharacter(initiatorId);
    const target = this.requireCharacter(targetId);
    if (initiator.agentAvailability === "unavailable") throw conflict("AGENT_UNAVAILABLE", "Unavailable agents cannot start synchronous conversations");
    if (target.agentAvailability === "unavailable") throw conflict("TARGET_AGENT_UNAVAILABLE", "The target runtime is unavailable for a synchronous conversation");
    if (initiatorId === targetId) throw invalid("SELF_CONVERSATION", "Cannot start a conversation with oneself");
    if (initiator.locationId !== target.locationId) throw invalid("NOT_COLOCATED", "Characters must be at the same location");
    this.requireInteractionCompatible(initiator);
    this.requireInteractionCompatible(target);
    const busyConversation = [...this.state.conversations.values()].find((conversation) =>
      conversation.status === "active" && conversation.participantIds.some((id) => id === initiatorId || id === targetId));
    if (busyConversation) throw conflict("CONVERSATION_BUSY", "One of the characters is already in an active conversation");
    const pairAvailability = this.conversationAvailability(initiator, target);
    if (pairAvailability.blockingCode === "RECENT_CONVERSATION_COOLDOWN") {
      throw new DomainError(
        "RECENT_CONVERSATION_COOLDOWN",
        `This pair can start another conversation after ${pairAvailability.availableAgainAt}`,
        409,
        pairAvailability,
      );
    }
    if (openingMessage) requiredText(openingMessage, "opening message", this.config.conversation.maximumMessageCharacters);
    const socialEnergyCost = pairAvailability.startEnergyCost;
    const openingTurnEnergyCost = openingMessage ? this.conversationTurnEnergyCost(0) : 0;
    if (!Number.isFinite(socialEnergyCost) || socialEnergyCost < 0 || socialEnergyCost > this.config.energy.maximum) {
      throw new Error("Configured social interaction energy cost is invalid");
    }
    this.requireEnergy(initiator, socialEnergyCost + openingTurnEnergyCost);
    const energyEvent = socialEnergyCost > 0
      ? this.changeEnergy(initiatorId, -socialEnergyCost, "social_interaction")
      : null;
    const conversationId = this.idGenerator();
    const event = this.record("CONVERSATION_STARTED", {
      actorCharacterId: initiatorId,
      subjectCharacterId: targetId,
      causedByEventIds: [energyEvent?.id].filter(Boolean),
      data: {
        conversationId,
        initiatorId,
        targetId,
        participantIds: [initiatorId, targetId],
        locationId: initiator.locationId,
        startedAt: this.clock.now().toISOString(),
        socialEnergyCost,
        recentPairConversationCount: pairAvailability.recentConversationCount,
        duringActivities: [initiator, target]
          .filter((character) => character.activity)
          .map((character) => ({
            characterId: character.id, type: character.activity.type,
            jobId: character.activity.jobId ?? null, eventId: character.activity.eventId ?? null,
          })),
      },
    });
    this.ensureRelationshipEdge(initiatorId, targetId, event.id);
    this.ensureRelationshipEdge(targetId, initiatorId, event.id);
    this.evaluateAndMaybeNotify(event, targetId, { directTarget: true });
    if (openingMessage) this.sendMessage(initiatorId, conversationId, openingMessage, [], { opening: true });
    return event;
  }

  sendMessage(senderId, conversationId, text, sharedFacts = [], options = {}) {
    const sender = this.requireCharacter(senderId);
    const conversation = this.requireConversation(conversationId);
    if (!conversation.participantIds.includes(senderId)) throw forbidden("NOT_PARTICIPANT", "Character is not a conversation participant");
    const responseNotification = this.findConversationNotification(senderId, conversationId, true);
    if (responseNotification?.[1].status === "expired") throw conflict("REACTION_WINDOW_EXPIRED", "The conversation response window has expired");
    if (conversation.status !== "active") throw conflict("CONVERSATION_ENDED", "Conversation is no longer active");
    if (!options.opening && conversation.expectedResponderId && conversation.expectedResponderId !== senderId) {
      throw conflict("OUT_OF_TURN", "Another participant is expected to respond");
    }
    if (conversation.messages.length >= this.config.conversation.maximumTurns) throw conflict("CONVERSATION_TURN_LIMIT", "Conversation turn limit reached");
    const oneMinuteAgo = addGameMinutes(this.clock.now(), -1);
    const recentTurns = conversation.messages.filter((message) => new Date(message.sentAt) > oneMinuteAgo).length;
    if (recentTurns >= this.config.conversation.maximumTurnsPerWorldMinute) {
      throw new DomainError("CONVERSATION_RATE_LIMITED", "Conversation turn frequency limit reached", 429);
    }
    requiredText(text, "message", this.config.conversation.maximumMessageCharacters);
    if (!Array.isArray(sharedFacts) || sharedFacts.length > this.config.conversation.maximumSharedFactsPerTurn) {
      throw invalid("INVALID_FACTS", `At most ${this.config.conversation.maximumSharedFactsPerTurn} structured facts may be shared`);
    }
    const facts = sharedFacts.map(normalizeFact);
    const turnEnergyCost = this.conversationTurnEnergyCost(conversation.messages.length);
    if (!Number.isFinite(turnEnergyCost) || turnEnergyCost < 0 || turnEnergyCost > this.config.energy.maximum) {
      throw new Error("Configured conversation turn energy cost is invalid");
    }
    this.requireEnergy(sender, turnEnergyCost);
    const reachesTurnLimit = conversation.messages.length + 1 >= this.config.conversation.maximumTurns;
    const response = this.resolveConversationResponse(senderId, conversationId, "message");
    const energyEvent = turnEnergyCost > 0
      ? this.changeEnergy(senderId, -turnEnergyCost, "conversation_turn")
      : null;
    const messageId = this.idGenerator();
    const event = this.record("CONVERSATION_MESSAGE_SENT", {
      actorCharacterId: senderId,
      causedByEventIds: [response?.id, energyEvent?.id, conversation.lastEventId ?? conversation.startedByEventId].filter(Boolean),
      data: {
        conversationId, messageId, senderId, participantIds: conversation.participantIds,
        text, sharedFacts: facts, energyCost: turnEnergyCost, endsConversation: reachesTurnLimit,
      },
    });

    for (const recipientId of conversation.participantIds.filter((id) => id !== senderId)) {
      if (!reachesTurnLimit) this.evaluateAndMaybeNotify(event, recipientId, { directTarget: true });
      for (const fact of facts) {
        this.record("KNOWLEDGE_LEARNED", {
          actorCharacterId: senderId,
          subjectCharacterId: recipientId,
          causedByEventIds: [event.id],
          data: { characterId: recipientId, sourceCharacterId: senderId, messageId, fact },
        });
      }
    }
    if (reachesTurnLimit) {
      const ended = this.record("CONVERSATION_ENDED", {
        actorCharacterId: senderId,
        causedByEventIds: [event.id],
        data: this.conversationCompletionData(conversation, senderId, "turn_limit"),
      });
      this.resolveRemainingConversationNotifications(conversationId, ended.id);
    }
    return event;
  }

  endConversation(characterId, conversationId) {
    const conversation = this.requireConversation(conversationId);
    if (conversation.status !== "active") throw conflict("CONVERSATION_ENDED", "Conversation is already ended");
    if (!conversation.participantIds.includes(characterId)) throw forbidden("NOT_PARTICIPANT", "Character is not a conversation participant");
    const response = this.resolveConversationResponse(characterId, conversationId, "conversation_ended");
    const ended = this.record("CONVERSATION_ENDED", {
      actorCharacterId: characterId,
      causedByEventIds: [response?.id, conversation.lastEventId ?? conversation.startedByEventId].filter(Boolean),
      data: this.conversationCompletionData(conversation, characterId, "participant_ended"),
    });
    this.resolveRemainingConversationNotifications(conversationId, ended.id);
    return ended;
  }

  appraiseInteraction(perceiverId, otherId, appraisal, { conversationId = null, interactionKind = "interaction", causedByEventIds = [] } = {}) {
    const perceiver = this.requireCharacter(perceiverId);
    const other = this.requireCharacter(otherId);
    if (perceiver.locationId !== other.locationId) throw invalid("NOT_COLOCATED", "Social appraisals require co-presence");
    if (conversationId) {
      const conversation = this.requireConversation(conversationId);
      if (!conversation.participantIds.includes(perceiverId) || !conversation.participantIds.includes(otherId)) {
        throw invalid("UNRELATED_CONVERSATION", "Conversation does not include both characters");
      }
    }
    const ruleByKindAndAppraisal = {
      "greeting:appreciated": "greeting_appreciated",
      "interaction:appreciated": "interaction_appreciated",
      "rejection:uncomfortable": "rejection_uncomfortable",
      "insult:offended": "insult_offended",
    };
    const ruleName = ruleByKindAndAppraisal[`${interactionKind}:${appraisal}`] ?? null;
    if (appraisal !== "neutral" && !ruleName) throw invalid("INVALID_APPRAISAL", "Unsupported appraisal for this interaction kind");
    this.ensureRelationshipEdge(perceiverId, otherId, causedByEventIds[0] ?? null);
    const appraisalCauses = [...causedByEventIds];
    if (conversationId && appraisalCauses.length === 0) {
      const conversation = this.requireConversation(conversationId);
      appraisalCauses.push(conversation.lastEventId ?? conversation.startedByEventId);
    }
    const appraisalEvent = this.record("RELATIONSHIP_APPRAISAL_RECORDED", {
      actorCharacterId: perceiverId,
      subjectCharacterId: otherId,
      causedByEventIds: appraisalCauses,
      data: {
        fromId: perceiverId, toId: otherId, appraisal, interactionKind, conversationId,
        relationshipRuleVersion: this.config.relationship.policyVersion,
      },
    });
    if (appraisal === "neutral") return appraisalEvent;
    const changes = this.applyRelationshipRule(ruleName, {
      fromId: perceiverId,
      toId: otherId,
      appraisal,
      causedByEventIds: [appraisalEvent.id],
    });
    return changes.at(-1) ?? appraisalEvent;
  }

  recordObjectiveRelationshipOutcome({ ruleName, beneficiaryId, otherCharacterId, evidenceEventId }) {
    const rule = this.config.relationship.rules[ruleName];
    if (!rule || rule.sourceType !== "objective_outcome") {
      throw invalid("INVALID_OBJECTIVE_OUTCOME", "The relationship rule is not an objective outcome");
    }
    this.requireCharacter(beneficiaryId);
    this.requireCharacter(otherCharacterId);
    const evidence = this.history.find((event) => event.id === evidenceEventId);
    if (!evidence || !this.characterMayReference(beneficiaryId, evidence)) {
      throw forbidden("INVALID_OUTCOME_EVIDENCE", "Objective relationship outcome requires visible authoritative evidence");
    }
    const outcome = this.record("RELATIONSHIP_OBJECTIVE_OUTCOME_RECORDED", {
      actorCharacterId: beneficiaryId,
      subjectCharacterId: otherCharacterId,
      causedByEventIds: [evidence.id],
      data: {
        fromId: beneficiaryId, toId: otherCharacterId, rule: ruleName,
        evidenceEventId: evidence.id, relationshipRuleVersion: this.config.relationship.policyVersion,
      },
    });
    const changes = this.applyRelationshipRule(ruleName, {
      fromId: beneficiaryId,
      toId: otherCharacterId,
      causedByEventIds: [outcome.id, evidence.id],
    });
    return changes.at(-1) ?? outcome;
  }

  endActiveConversations(characterId, reason, causedByEventId) {
    const conversations = [...this.state.conversations.values()].filter((conversation) =>
      conversation.status === "active" && conversation.participantIds.includes(characterId));
    for (const conversation of conversations) {
      const ended = this.record("CONVERSATION_ENDED", {
        actorCharacterId: characterId,
        causedByEventIds: [causedByEventId],
        data: this.conversationCompletionData(conversation, characterId, reason),
      });
      this.resolveRemainingConversationNotifications(conversation.id, ended.id);
    }
  }

  startCoPresence(firstCharacterId, secondCharacterId, locationId, causedByEventId) {
    const participantIds = [firstCharacterId, secondCharacterId].sort();
    const key = coPresenceKey(participantIds[0], participantIds[1], locationId);
    if (this.state.coPresence.has(key)) return null;
    return this.record("CO_PRESENCE_STARTED", {
      actorCharacterId: firstCharacterId,
      subjectCharacterId: secondCharacterId,
      causedByEventIds: [causedByEventId],
      data: {
        episodeId: this.idGenerator(), participantIds, locationId,
        startedAt: this.clock.now().toISOString(), interactionEligible: true,
      },
    });
  }

  endCoPresenceForCharacter(characterId, causedByEventId) {
    const episodes = [...this.state.coPresence.values()].filter((episode) => episode.participantIds.includes(characterId));
    for (const episode of episodes) {
      this.record("CO_PRESENCE_ENDED", {
        actorCharacterId: characterId,
        subjectCharacterId: episode.participantIds.find((id) => id !== characterId),
        causedByEventIds: [episode.startedByEventId, causedByEventId],
        data: {
          episodeId: episode.id, participantIds: [...episode.participantIds], locationId: episode.locationId,
          startedAt: episode.startedAt, endedAt: this.clock.now().toISOString(),
          durationGameMinutes: Math.max(0, (this.clock.now() - new Date(episode.startedAt)) / 60_000),
          interactionEligible: episode.interactionEligible,
        },
      });
    }
  }

  conversationCompletionData(conversation, endedById, reason, endedAt = this.clock.now()) {
    const producedFactIds = [...new Set(conversation.messages.flatMap((message) => message.sharedFacts.map((fact) => fact.id)))];
    return {
      conversationId: conversation.id,
      endedById,
      participantIds: [...conversation.participantIds],
      startedAt: conversation.startedAt,
      endedAt: new Date(endedAt).toISOString(),
      durationGameMinutes: Math.max(0, (new Date(endedAt) - new Date(conversation.startedAt)) / 60_000),
      turnCount: conversation.messages.length,
      producedFactIds,
      reason,
    };
  }

  applyRelationshipRule(ruleName, { fromId, toId, appraisal = null, causedByEventIds = [] }) {
    this.requireCharacter(fromId);
    this.requireCharacter(toId);
    const rule = this.config.relationship.rules[ruleName];
    if (!rule) throw invalid("UNKNOWN_RELATIONSHIP_RULE", `Unknown relationship rule: ${ruleName}`);
    this.ensureRelationshipEdge(fromId, toId, causedByEventIds[0] ?? null);
    let multiplier = 1;
    if (rule.sourceType === "subjective_appraisal" && rule.affinity > 0) {
      const worldDay = this.clock.now().toISOString().slice(0, 10);
      const prior = this.history.filter((event) => event.type === "RELATIONSHIP_CHANGED"
        && event.data.fromId === fromId && event.data.toId === toId
        && event.data.sourceType === "subjective_appraisal"
        && event.data.category === rule.category
        && event.worldTime.slice(0, 10) === worldDay).length;
      multiplier = prior === 0 ? 1 : prior === 1 ? 0.5 : 0;
    }
    const changes = [];
    for (const dimension of ["affinity", "trust", "tension"]) {
      const configuredDelta = rule[dimension] ?? 0;
      const delta = configuredDelta > 0 && dimension === "affinity" ? configuredDelta * multiplier : configuredDelta;
      if (delta === 0) continue;
      const relationship = this.getRelationship(fromId, toId);
      const previous = relationship[dimension];
      const minimum = dimension === "tension" ? this.config.relationship.tensionMinimum : this.config.relationship.minimum;
      const maximum = dimension === "tension" ? this.config.relationship.tensionMaximum : this.config.relationship.maximum;
      const value = clamp(previous + delta, minimum, maximum);
      if (value === previous) continue;
      changes.push(this.record("RELATIONSHIP_CHANGED", {
        actorCharacterId: fromId,
        subjectCharacterId: toId,
        causedByEventIds,
        data: {
          fromId, toId, dimension, previous, delta: value - previous, value,
          rule: ruleName, category: rule.category, sourceType: rule.sourceType,
          appraisal, relationshipRuleVersion: this.config.relationship.policyVersion,
        },
      }));
    }
    return changes;
  }

  ensureRelationshipEdge(fromId, toId, causedByEventId = null) {
    const existing = this.getRelationship(fromId, toId);
    if (existing) return existing;
    this.record("RELATIONSHIP_CREATED", {
      actorCharacterId: fromId,
      subjectCharacterId: toId,
      causedByEventIds: causedByEventId ? [causedByEventId] : [],
      data: {
        fromId, toId, affinity: 0, trust: 0, tension: 0,
        reason: "valid_contact", relationshipRuleVersion: this.config.relationship.policyVersion,
      },
    });
    return this.getRelationship(fromId, toId);
  }

  recordDecision(characterId, summary, influencedByEventIds) {
    this.requireCharacter(characterId);
    requiredText(summary, "decision summary", 500);
    if (!Array.isArray(influencedByEventIds) || influencedByEventIds.length === 0 || influencedByEventIds.length > 12) {
      throw invalid("MISSING_CAUSALITY", "A later decision must reference 1-12 permitted causal events");
    }
    for (const eventId of influencedByEventIds) {
      const source = this.history.find((event) => event.id === eventId);
      if (!source || !this.characterMayReference(characterId, source)) {
        throw forbidden("HIDDEN_CAUSE", `Character may not reference event ${eventId}`);
      }
    }
    return this.record("DECISION_RECORDED", {
      actorCharacterId: characterId,
      causedByEventIds: influencedByEventIds,
      data: { characterId, summary },
    });
  }

  proposeSecondaryGoal(characterId, proposal) {
    const character = this.requireCharacter(characterId);
    if (!proposal || typeof proposal !== "object") throw invalid("INVALID_GOAL", "Secondary goal proposal is required");
    const source = this.history.find((event) => event.id === proposal.sourceEventId);
    if (!source || !this.characterMayReference(characterId, source)) throw forbidden("UNKNOWN_GOAL_SOURCE", "Secondary goal source was not perceived by the character");
    if (!this.config.goals.secondaryTypes.includes(proposal.type)) throw invalid("INVALID_GOAL_TYPE", "Secondary goal type is not allowed");
    const active = character.secondaryGoals.filter((goal) => goal.status === "active");
    if (active.length >= this.config.goals.maximumActiveSecondaryGoals) throw conflict("SECONDARY_GOAL_CAPACITY", "Maximum active secondary goals reached");
    const targetId = proposal.targetId ? String(proposal.targetId) : null;
    this.validateGoalTarget(characterId, proposal.type, targetId);
    if (active.some((goal) => goal.type === proposal.type && goal.targetId === targetId)) {
      throw conflict("DUPLICATE_SECONDARY_GOAL", "An equivalent secondary goal is already active");
    }
    const now = this.clock.now();
    const defaultExpiry = addGameMinutes(now, this.config.goals.defaultSecondaryGoalWorldDays * 24 * 60);
    const requestedExpiry = proposal.expiresAt ? new Date(proposal.expiresAt) : defaultExpiry;
    if (!(requestedExpiry > now) || requestedExpiry > defaultExpiry) throw invalid("INVALID_GOAL_EXPIRY", "Secondary goal expiry must be in the future and within seven world days");
    const goal = normalizeGoal({
      id: this.idGenerator(), type: proposal.type, targetId,
      priority: proposal.priority, guidance: proposal.declaredReason ?? "",
      expiresAt: requestedExpiry.toISOString(), sourceEventId: source.id,
    }, { className: "secondary" });
    return this.record("SECONDARY_GOAL_ADOPTED", {
      actorCharacterId: characterId,
      causedByEventIds: [source.id],
      data: { characterId, goal: { ...goal, status: "active", adoptedAt: now.toISOString() }, goalsPolicyVersion: this.config.goals.policyVersion },
    });
  }

  abandonSecondaryGoal(characterId, goalId) {
    const character = this.requireCharacter(characterId);
    const goal = character.secondaryGoals.find((item) => item.id === goalId);
    if (!goal) throw new DomainError("GOAL_NOT_FOUND", "Secondary goal not found", 404);
    if (goal.status !== "active") throw conflict("GOAL_NOT_ACTIVE", "Secondary goal is not active");
    return this.record("SECONDARY_GOAL_ABANDONED", {
      actorCharacterId: characterId,
      data: { characterId, goalId, goalsPolicyVersion: this.config.goals.policyVersion },
    });
  }

  validateGoalTarget(characterId, type, targetId) {
    const characterTargetTypes = new Set(["strengthen_relationship", "avoid_character", "resolve_conflict"]);
    if (characterTargetTypes.has(type)) {
      if (!targetId) throw invalid("GOAL_TARGET_REQUIRED", "This goal type requires a character target");
      this.requireCharacter(targetId);
      if (!this.getRelationship(characterId, targetId)) throw forbidden("UNKNOWN_GOAL_TARGET", "Character target is not known");
      return;
    }
    if (type === "visit_location") {
      if (!targetId) throw invalid("GOAL_TARGET_REQUIRED", "Visit-location goals require a location");
      this.requireLocation(targetId);
      return;
    }
    if (type === "attend_event") {
      if (!targetId) throw invalid("GOAL_TARGET_REQUIRED", "Attend-event goals require an event");
      this.requireGathering(targetId);
      return;
    }
    if (type === "find_work" && targetId) this.requireLocation(targetId);
  }

  evaluateGoalCompletion(evidenceEvent) {
    if (["SECONDARY_GOAL_ADOPTED", "SECONDARY_GOAL_COMPLETED", "SECONDARY_GOAL_ABANDONED", "SECONDARY_GOAL_EXPIRED"].includes(evidenceEvent.type)) return;
    for (const character of this.state.characters.values()) {
      for (const goal of character.secondaryGoals.filter((item) => item.status === "active")) {
        if (!this.characterMayReference(character.id, evidenceEvent) || !goalMatchesEvidence(goal, character.id, evidenceEvent)) continue;
        this.record("SECONDARY_GOAL_COMPLETED", {
          actorCharacterId: character.id,
          causedByEventIds: [goal.sourceEventId, evidenceEvent.id],
          data: { characterId: character.id, goalId: goal.id, evidenceEventId: evidenceEvent.id, goalsPolicyVersion: this.config.goals.policyVersion },
        });
      }
    }
  }

  acknowledgeNotification(characterId, notificationEventId) {
    this.requireCharacter(characterId);
    const notification = this.state.notifications.get(notificationEventId);
    if (!notification || notification.characterId !== characterId) throw new DomainError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
    if (notification.ackEventId) return this.history.find((event) => event.id === notification.ackEventId);
    if (notification.status === "queued") throw conflict("NOTIFICATION_NOT_DELIVERED", "Notification must be delivered before acknowledgement");
    if (isNotificationTerminal(notification.status)) throw conflict("NOTIFICATION_RESOLVED", "Notification is already resolved");
    return this.record("AGENT_NOTIFICATION_ACKNOWLEDGED", {
      actorCharacterId: characterId,
      causedByEventIds: [notificationEventId],
      data: { characterId, notificationEventId },
    });
  }

  markNotificationDelivered(characterId, notificationEventId, deliveredAtReal = new Date()) {
    this.requireCharacter(characterId);
    const notification = this.state.notifications.get(notificationEventId);
    if (!notification || notification.characterId !== characterId) throw new DomainError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
    if (notification.deliveredEventId) return this.getNotificationEnvelope(notificationEventId);
    if (isNotificationTerminal(notification.status)) throw conflict("NOTIFICATION_RESOLVED", "Notification is already resolved");
    const worldMinutes = notification.requestKind === "conversation_response"
      ? this.config.timing.conversationResponseWorldMinutes
      : notification.urgency === "critical"
        ? this.config.timing.criticalEventReactionWorldMinutes
        : this.config.timing.highEventReactionWorldMinutes;
    const deliveredReal = new Date(deliveredAtReal);
    if (Number.isNaN(deliveredReal.getTime())) throw invalid("INVALID_TIME", "Delivery time is invalid");
    const realDuration = typeof this.clock.realMillisecondsForGameMinutes === "function"
      ? this.clock.realMillisecondsForGameMinutes(worldMinutes)
      : worldMinutes * 60_000 / 6;
    this.record("AGENT_NOTIFICATION_DELIVERED", {
      actorCharacterId: characterId,
      causedByEventIds: [notificationEventId],
      data: {
        characterId,
        notificationEventId,
        deliveredAt: this.clock.now().toISOString(),
        deliveredAtReal: deliveredReal.toISOString(),
        respondByWorldTime: addGameMinutes(this.clock.now(), worldMinutes).toISOString(),
        respondByRealTime: new Date(deliveredReal.getTime() + realDuration).toISOString(),
        timingPolicyVersion: this.config.timing.policyVersion,
      },
    });
    return this.getNotificationEnvelope(notificationEventId);
  }

  markNotificationDeliveryFailed(characterId, notificationEventId, failureCode = "transport_error") {
    this.requireCharacter(characterId);
    const notification = this.state.notifications.get(notificationEventId);
    if (!notification || notification.characterId !== characterId) throw new DomainError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
    if (isNotificationTerminal(notification.status)) return null;
    return this.record("AGENT_NOTIFICATION_DELIVERY_FAILED", {
      actorCharacterId: characterId,
      causedByEventIds: [notificationEventId],
      data: { characterId, notificationEventId, failureCode: String(failureCode).slice(0, 100) },
    });
  }

  getNotificationEnvelope(notificationEventId) {
    const notification = this.state.notifications.get(notificationEventId);
    if (!notification) throw new DomainError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
    const queuedEvent = this.history.find((event) => event.id === notificationEventId);
    return {
      id: notificationEventId,
      cursor: queuedEvent.sequence,
      characterId: notification.characterId,
      sourceEventId: notification.sourceEventId,
      level: notification.level,
      urgency: notification.urgency,
      summary: notification.summary,
      requestKind: notification.requestKind,
      conversationId: notification.conversationId,
      invitationId: notification.invitationId,
      commitmentId: notification.commitmentId,
      compatibleActions: notification.compatibleActions,
      status: notification.status,
      queuedAt: notification.queuedAt,
      deliveredAt: notification.deliveredAt ?? null,
      respondByWorldTime: notification.respondByWorldTime ?? null,
      respondByRealTime: notification.respondByRealTime ?? null,
      timingPolicyVersion: notification.timingPolicyVersion ?? this.config.timing.policyVersion,
      deliveryAttempts: notification.deliveryAttempts ?? 0,
      lastDeliveryFailureAt: notification.lastDeliveryFailureAt ?? null,
      lastDeliveryFailureCode: notification.lastDeliveryFailureCode ?? null,
    };
  }

  ignoreEvent(characterId, notificationEventId) {
    const notification = this.requireOpenNotification(characterId, notificationEventId);
    if (notification.requestKind === "conversation_response") throw invalid("WRONG_REACTION_TYPE", "Use remain_silent for a conversation response");
    const resolved = this.record("AGENT_REACTION_RESOLVED", {
      actorCharacterId: characterId,
      causedByEventIds: [notificationEventId],
      data: { characterId, notificationEventId, sourceEventId: notification.sourceEventId, outcome: "no_action", explicit: true },
    });
    this.resolveNotification(notificationEventId, "resolved", resolved.id, "no_action");
    return resolved;
  }

  remainSilent(characterId, conversationId) {
    const conversation = this.requireConversation(conversationId);
    if (conversation.status !== "active") throw conflict("CONVERSATION_ENDED", "Conversation is no longer active");
    if (!conversation.participantIds.includes(characterId)) throw forbidden("NOT_PARTICIPANT", "Character is not a conversation participant");
    if (conversation.expectedResponderId !== characterId) throw conflict("OUT_OF_TURN", "Another participant is expected to respond");
    const notificationEntry = this.findConversationNotification(characterId, conversationId, false);
    if (!notificationEntry) throw conflict("NO_RESPONSE_EXPECTED", "No conversation response is currently expected");
    this.ensureNotificationWindowOpen(notificationEntry[0], notificationEntry[1]);
    const silence = this.record("SILENCE_RESOLVED", {
      actorCharacterId: characterId,
      causedByEventIds: [notificationEntry[0]],
      data: { characterId, conversationId, notificationEventId: notificationEntry[0], explicit: true, outcome: "remain_silent" },
    });
    this.resolveNotification(notificationEntry[0], "resolved", silence.id, "remain_silent");
    const waitingCharacterId = conversation.participantIds.find((id) => id !== characterId);
    this.applyRelationshipRule("expected_response_silence", {
      fromId: waitingCharacterId,
      toId: characterId,
      causedByEventIds: [silence.id],
    });
    const ended = this.record("CONVERSATION_ENDED", {
      actorCharacterId: characterId,
      causedByEventIds: [silence.id],
      data: this.conversationCompletionData(conversation, characterId, "explicit_silence"),
    });
    this.resolveRemainingConversationNotifications(conversationId, ended.id);
    return silence;
  }

  resolveConversationResponse(characterId, conversationId, outcome) {
    const entry = this.findConversationNotification(characterId, conversationId, true);
    if (!entry) return null;
    const [notificationEventId, notification] = entry;
    if (notification.status === "expired") throw conflict("REACTION_WINDOW_EXPIRED", "The conversation response window has expired");
    if (isNotificationTerminal(notification.status)) return null;
    this.ensureNotificationWindowOpen(notificationEventId, notification);
    const response = this.record("CONVERSATION_RESPONSE_RECORDED", {
      actorCharacterId: characterId,
      causedByEventIds: [notificationEventId],
      data: { characterId, conversationId, notificationEventId, outcome },
    });
    this.resolveNotification(notificationEventId, "resolved", response.id, outcome);
    return response;
  }

  findConversationNotification(characterId, conversationId, includeTerminal) {
    return [...this.state.notifications.entries()]
      .filter(([, notification]) => notification.characterId === characterId && notification.conversationId === conversationId)
      .filter(([, notification]) => includeTerminal || !isNotificationTerminal(notification.status))
      .sort((a, b) => b[1].queuedAt.localeCompare(a[1].queuedAt))[0] ?? null;
  }

  requireOpenNotification(characterId, notificationEventId) {
    this.requireCharacter(characterId);
    const notification = this.state.notifications.get(notificationEventId);
    if (!notification || notification.characterId !== characterId) throw new DomainError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
    if (notification.status === "expired") throw conflict("REACTION_WINDOW_EXPIRED", "The reaction window has expired");
    if (isNotificationTerminal(notification.status)) throw conflict("NOTIFICATION_RESOLVED", "Notification is already resolved");
    this.ensureNotificationWindowOpen(notificationEventId, notification);
    return notification;
  }

  ensureNotificationWindowOpen(notificationEventId, notification) {
    if (this.state.platformIncident) return;
    if (notification.respondByWorldTime && this.clock.now() > new Date(notification.respondByWorldTime)) {
      this.expireNotification(notificationEventId, notification.respondByWorldTime);
      throw conflict("REACTION_WINDOW_EXPIRED", "The reaction window has expired");
    }
    if (notification.respondByRealTime && new Date() > new Date(notification.respondByRealTime)) {
      this.expireNotification(notificationEventId, this.clock.now().toISOString());
      throw conflict("REACTION_WINDOW_EXPIRED", "The reaction window has expired");
    }
  }

  resolveNotification(notificationEventId, status, resolutionEventId, outcome) {
    const notification = this.state.notifications.get(notificationEventId);
    if (!notification || isNotificationTerminal(notification.status)) return null;
    return this.record("AGENT_NOTIFICATION_RESOLVED", {
      actorCharacterId: notification.characterId,
      causedByEventIds: [notificationEventId, resolutionEventId],
      data: { notificationEventId, characterId: notification.characterId, status, outcome, resolutionEventId },
    });
  }

  resolveRemainingConversationNotifications(conversationId, resolutionEventId) {
    for (const [notificationEventId, notification] of this.state.notifications.entries()) {
      if (notification.conversationId === conversationId && !isNotificationTerminal(notification.status)) {
        this.resolveNotification(notificationEventId, "cancelled", resolutionEventId, "conversation_ended");
      }
    }
  }

  expireNotification(notificationEventId, worldTime) {
    const notification = this.state.notifications.get(notificationEventId);
    if (!notification || isNotificationTerminal(notification.status)) return null;
    const expired = this.record("AGENT_NOTIFICATION_EXPIRED", {
      actorCharacterId: notification.characterId,
      causedByEventIds: [notificationEventId],
      worldTime,
      data: {
        notificationEventId,
        characterId: notification.characterId,
        sourceEventId: notification.sourceEventId,
        requestKind: notification.requestKind,
        conversationId: notification.conversationId,
        invitationId: notification.invitationId,
        outcome: notification.requestKind === "conversation_response" ? "remain_silent" : "no_action",
        timingPolicyVersion: notification.timingPolicyVersion ?? this.config.timing.policyVersion,
        processingDelayWorldMilliseconds: Math.max(0, this.clock.now() - new Date(worldTime)),
      },
    });
    if (notification.requestKind === "conversation_response") {
      const conversation = this.state.conversations.get(notification.conversationId);
      this.record("CONVERSATION_TURN_EXPIRED", {
        actorCharacterId: notification.characterId,
        causedByEventIds: [expired.id, notification.sourceEventId],
        worldTime,
        data: { characterId: notification.characterId, conversationId: notification.conversationId, notificationEventId },
      });
      const silence = this.record("SILENCE_RESOLVED", {
        actorCharacterId: notification.characterId,
        causedByEventIds: [expired.id],
        worldTime,
        data: { characterId: notification.characterId, conversationId: notification.conversationId, notificationEventId, explicit: false, outcome: "remain_silent" },
      });
      const waitingCharacterId = conversation?.participantIds.find((id) => id !== notification.characterId);
      if (waitingCharacterId) {
        this.applyRelationshipRule("expected_response_silence", {
          fromId: waitingCharacterId,
          toId: notification.characterId,
          causedByEventIds: [silence.id],
        });
      }
      if (conversation?.status === "active") {
        const ended = this.record("CONVERSATION_ENDED", {
          actorCharacterId: notification.characterId,
          causedByEventIds: [silence.id],
          worldTime,
          data: this.conversationCompletionData(conversation, notification.characterId, "no_response", worldTime),
        });
        this.resolveRemainingConversationNotifications(notification.conversationId, ended.id);
      }
      this.recordMissedResponse(notification.characterId, expired.id, worldTime);
    } else if (notification.requestKind === "invitation_response" && notification.invitationId) {
      const invitation = this.state.invitations.get(notification.invitationId);
      if (invitation?.status === "pending") {
        this.record("INVITATION_EXPIRED", {
          actorCharacterId: notification.characterId,
          subjectCharacterId: invitation.senderId,
          causedByEventIds: [expired.id, invitation.sentByEventId],
          worldTime,
          data: {
            invitationId: invitation.id, senderId: invitation.senderId, targetId: invitation.targetId,
            participantIds: [...invitation.participantIds], outcome: "no_response",
          },
        });
      }
      this.recordMissedResponse(notification.characterId, expired.id, worldTime);
    } else {
      this.record("AGENT_REACTION_TIMED_OUT", {
        actorCharacterId: notification.characterId,
        causedByEventIds: [expired.id],
        worldTime,
        data: { characterId: notification.characterId, notificationEventId, sourceEventId: notification.sourceEventId, outcome: "no_action" },
      });
      this.recordMissedResponse(notification.characterId, expired.id, worldTime);
    }
    return expired;
  }

  recordMissedResponse(characterId, causedByEventId, worldTime) {
    const character = this.requireCharacter(characterId);
    const count = character.consecutiveMissedResponses + 1;
    const availability = count >= this.config.timing.unavailableAfterMissedResponses ? "unavailable" : character.agentAvailability;
    return this.record("AGENT_RESPONSE_MISSED", {
      actorCharacterId: characterId,
      causedByEventIds: [causedByEventId],
      worldTime,
      data: { characterId, consecutiveMissedResponses: count, availability },
    });
  }

  verifyAgentRecovery(characterId) {
    const character = this.requireCharacter(characterId);
    if (character.agentAvailability === "available" && character.consecutiveMissedResponses === 0) return null;
    return this.record("AGENT_RECOVERY_VERIFIED", {
      actorCharacterId: characterId,
      data: { characterId, previousMissedResponses: character.consecutiveMissedResponses, availability: "available" },
    });
  }

  confirmPlatformIncident({ id = this.idGenerator(), startedAtReal = new Date() } = {}) {
    if (this.state.platformIncident) throw conflict("PLATFORM_INCIDENT_ACTIVE", "A platform incident is already active");
    requiredId(id, "platform incident id");
    const realTime = new Date(startedAtReal);
    if (Number.isNaN(realTime.getTime())) throw invalid("INVALID_TIME", "Platform incident real time is invalid");
    return this.record("PLATFORM_INCIDENT_CONFIRMED", {
      data: { incidentId: id, startedAtWorld: this.clock.now().toISOString(), startedAtReal: realTime.toISOString() },
    });
  }

  resolvePlatformIncident({ resolvedAtReal = new Date() } = {}) {
    const incident = this.state.platformIncident;
    if (!incident) throw conflict("NO_PLATFORM_INCIDENT", "No platform incident is active");
    const resolvedReal = new Date(resolvedAtReal);
    if (Number.isNaN(resolvedReal.getTime()) || resolvedReal < new Date(incident.startedAtReal)) {
      throw invalid("INVALID_TIME", "Platform incident resolution time is invalid");
    }
    const resolvedAtWorld = this.clock.now();
    const worldDurationMs = Math.max(0, resolvedAtWorld - new Date(incident.startedAtWorld));
    const realDurationMs = resolvedReal - new Date(incident.startedAtReal);
    const resolved = this.record("PLATFORM_INCIDENT_RESOLVED", {
      causedByEventIds: [incident.eventId],
      data: {
        incidentId: incident.id, resolvedAtWorld: resolvedAtWorld.toISOString(), resolvedAtReal: resolvedReal.toISOString(),
        worldDurationMilliseconds: worldDurationMs, realDurationMilliseconds: realDurationMs,
      },
    });
    for (const [notificationEventId, notification] of this.state.notifications.entries()) {
      if (isNotificationTerminal(notification.status) || !notification.respondByWorldTime) continue;
      this.record("DEADLINE_SUPPRESSED_FOR_PLATFORM_INCIDENT", {
        actorCharacterId: notification.characterId,
        causedByEventIds: [incident.eventId, resolved.id, notificationEventId],
        data: {
          incidentId: incident.id, notificationEventId, characterId: notification.characterId,
          previousRespondByWorldTime: notification.respondByWorldTime,
          respondByWorldTime: new Date(new Date(notification.respondByWorldTime).getTime() + worldDurationMs).toISOString(),
          previousRespondByRealTime: notification.respondByRealTime,
          respondByRealTime: notification.respondByRealTime
            ? new Date(new Date(notification.respondByRealTime).getTime() + realDurationMs).toISOString()
            : null,
        },
      });
    }
    for (const job of this.state.jobs.values()) {
      if (!["open", "accepted"].includes(job.status)) continue;
      this.record("JOB_DEADLINE_EXTENDED_FOR_PLATFORM_INCIDENT", {
        causedByEventIds: [incident.eventId, resolved.id],
        data: {
          incidentId: incident.id, jobId: job.id,
          offerExpiresAt: addMilliseconds(job.offerExpiresAt, worldDurationMs),
          scheduledStartAt: addMilliseconds(job.scheduledStartAt, worldDurationMs),
          startGraceUntil: addMilliseconds(job.startGraceUntil, worldDurationMs),
        },
      });
    }
    return resolved;
  }

  executeAgentAction(characterId, action, idempotencyKey = null) {
    this.requireCharacter(characterId);
    if (!action || typeof action !== "object") throw invalid("INVALID_ACTION", "Action body must be an object");
    const receiptKey = idempotencyKey ? `${characterId}:${idempotencyKey}` : null;
    if (receiptKey && this.state.actionReceipts.has(receiptKey)) {
      return structuredClone(this.state.actionReceipts.get(receiptKey).result);
    }
    if (action.expectedStateVersion !== undefined) {
      if (!Number.isInteger(action.expectedStateVersion) || action.expectedStateVersion < 0) {
        throw invalid("INVALID_STATE_VERSION", "expectedStateVersion must be a non-negative integer");
      }
      const currentVersion = this.characterStateVersion(characterId);
      if (action.expectedStateVersion !== currentVersion) {
        throw conflict("STALE_STATE_VERSION", `Expected character state version ${action.expectedStateVersion}, current version is ${currentVersion}`);
      }
    }

    let result;
    switch (action.type) {
      case "move": {
        const event = this.startMove(characterId, action.destinationId);
        result = this.actionResult(characterId, event, { expectedEndAt: event.data.expectedEndAt });
        break;
      }
      case "start_conversation": {
        const event = this.startConversation(characterId, action.targetCharacterId, action.openingMessage);
        result = this.actionResult(characterId, event, { conversationId: event.data.conversationId });
        break;
      }
      case "send_message": {
        const event = this.sendMessage(characterId, action.conversationId, action.text, action.sharedFacts);
        result = this.actionResult(characterId, event, { messageId: event.data.messageId });
        break;
      }
      case "end_conversation": {
        const event = this.endConversation(characterId, action.conversationId);
        result = this.actionResult(characterId, event);
        break;
      }
      case "remain_silent": {
        const event = this.remainSilent(characterId, action.conversationId);
        result = this.actionResult(characterId, event, { outcome: "remain_silent" });
        break;
      }
      case "ignore_event": {
        const event = this.ignoreEvent(characterId, action.notificationEventId);
        result = this.actionResult(characterId, event, { outcome: "no_action" });
        break;
      }
      case "appraise_interaction": {
        const event = this.appraiseInteraction(characterId, action.otherCharacterId, action.appraisal, {
          conversationId: action.conversationId,
          interactionKind: action.interactionKind,
        });
        result = this.actionResult(characterId, event, { relationship: this.getRelationship(characterId, action.otherCharacterId) });
        break;
      }
      case "accept_job": {
        const event = this.acceptJob(characterId, action.jobId);
        result = this.actionResult(characterId, event);
        break;
      }
      case "start_job": {
        const event = this.startJob(characterId, action.jobId);
        result = this.actionResult(characterId, event, { expectedEndAt: event.data.expectedEndAt });
        break;
      }
      case "cancel_job": {
        const event = this.cancelJob(characterId, action.jobId);
        result = this.actionResult(characterId, event, { jobStatus: event.data.terminalStatus });
        break;
      }
      case "rest": {
        const event = this.startRest(characterId);
        result = this.actionResult(characterId, event, {
          expectedEndAt: event.data.expectedEndAt,
          expectedRecovery: event.data.expectedRecovery,
        });
        break;
      }
      case "attend_event": {
        const event = this.attendEvent(characterId, action.eventId);
        result = this.actionResult(characterId, event, { expectedEndAt: event.data.expectedEndAt });
        break;
      }
      case "send_invitation": {
        const event = this.sendInvitation(characterId, action.targetCharacterId, {
          destinationType: action.destinationType,
          destinationId: action.destinationId,
          message: action.message,
        });
        result = this.actionResult(characterId, event, { invitationId: event.data.invitationId });
        break;
      }
      case "respond_invitation": {
        const event = this.respondToInvitation(characterId, action.invitationId, action.response);
        result = this.actionResult(characterId, event, {
          invitationId: action.invitationId, response: action.response,
          commitmentId: event.data.commitmentId ?? null,
        });
        break;
      }
      case "record_decision": {
        const event = this.recordDecision(characterId, action.summary, action.influencedByEventIds);
        result = this.actionResult(characterId, event);
        break;
      }
      case "propose_secondary_goal": {
        const event = this.proposeSecondaryGoal(characterId, action.goal);
        result = this.actionResult(characterId, event, { goal: event.data.goal });
        break;
      }
      case "abandon_secondary_goal": {
        const event = this.abandonSecondaryGoal(characterId, action.goalId);
        result = this.actionResult(characterId, event);
        break;
      }
      default:
        throw invalid("UNKNOWN_ACTION", `Unsupported action type: ${action.type}`);
    }

    if (receiptKey) {
      this.record("AGENT_ACTION_PROCESSED", {
        actorCharacterId: characterId,
        causedByEventIds: [result.eventId],
        data: { characterId, idempotencyKey, result, rulesVersion: this.config.rules.version },
      });
    }
    return result;
  }

  advanceTo(targetTime, targetRealTime = new Date()) {
    const target = new Date(targetTime);
    const realTarget = new Date(targetRealTime);
    if (Number.isNaN(target.getTime())) throw invalid("INVALID_TIME", "Cannot advance to invalid world time");
    if (Number.isNaN(realTarget.getTime())) throw invalid("INVALID_TIME", "Cannot advance to invalid real time");
    let due;
    while ((due = this.nextDueItem(target, realTarget))) {
      if (due.kind === "notification") {
        this.expireNotification(due.notificationEventId, due.worldTime);
        continue;
      }
      if (due.kind === "goal") {
        this.record("SECONDARY_GOAL_EXPIRED", {
          actorCharacterId: due.characterId,
          worldTime: due.worldTime,
          data: { characterId: due.characterId, goalId: due.goalId, goalsPolicyVersion: this.config.goals.policyVersion },
        });
        continue;
      }
      if (due.kind === "job_offer_expiry") {
        this.expireJobOffer(due.jobId, due.worldTime);
        continue;
      }
      if (due.kind === "job_no_show") {
        this.failJobForNoShow(due.jobId, due.worldTime);
        continue;
      }
      if (due.kind === "commitment_reminder") {
        const commitment = this.requireCommitment(due.commitmentId);
        const reminder = this.record("COMMITMENT_REMINDER_SENT", {
          actorCharacterId: commitment.participantIds[0], subjectCharacterId: commitment.participantIds[1],
          causedByEventIds: [commitment.createdByEventId], worldTime: due.worldTime,
          data: {
            commitmentId: commitment.id, participantIds: [...commitment.participantIds],
            locationId: commitment.locationId, eventId: commitment.eventId,
            startsAt: commitment.startsAt, endsAt: commitment.endsAt,
          },
        });
        for (const characterId of commitment.participantIds) {
          this.record("AGENT_NOTIFICATION_QUEUED", {
            actorCharacterId: commitment.participantIds.find((id) => id !== characterId),
            subjectCharacterId: characterId,
            causedByEventIds: [reminder.id, commitment.createdByEventId],
            worldTime: due.worldTime,
            data: {
              characterId, sourceEventId: reminder.id, commitmentId: commitment.id,
              level: "HIGH", urgency: "normal",
              summary: `Meeting commitment at ${this.requireLocation(commitment.locationId).name} starts at ${commitment.startsAt}.`,
              requestKind: "event_reaction", compatibleActions: ["ignore_event", "move"],
              timingPolicyVersion: this.config.timing.policyVersion,
            },
          });
        }
        continue;
      }
      if (due.kind === "commitment_start") {
        this.openCommitmentWindow(due.commitmentId, due.worldTime);
        continue;
      }
      if (due.kind === "commitment_deadline") {
        this.missCommitment(due.commitmentId, due.worldTime);
        continue;
      }
      const character = this.requireCharacter(due.characterId);
      const activity = character.activity;
      if (activity.type === "moving") {
        const arrival = this.record("CHARACTER_ARRIVED", {
          actorCharacterId: character.id,
          causedByEventIds: [activity.startedByEventId],
          worldTime: activity.expectedEndAt,
          data: {
            characterId: character.id, locationId: activity.destinationId,
            processingDelayWorldMilliseconds: Math.max(0, this.clock.now() - new Date(activity.expectedEndAt)),
          },
        });
        for (const observer of this.state.characters.values()) {
          if (observer.id !== character.id && observer.locationId === activity.destinationId && observer.activity?.type !== "moving") {
            this.startCoPresence(character.id, observer.id, activity.destinationId, arrival.id);
            this.evaluateAndMaybeNotify(arrival, observer.id);
          }
        }
        for (const commitment of this.state.commitments.values()) {
          if (commitment.locationId === activity.destinationId && commitment.participantIds.includes(character.id)) {
            this.evaluateCommitmentPresence(commitment.id, activity.expectedEndAt, arrival.id);
          }
        }
      } else if (activity.type === "work") {
        const job = this.requireJob(activity.jobId);
        if (job.status !== "running") continue;
        const workerIds = [...job.workerIds];
        const baseShare = Math.floor(job.compensation / workerIds.length);
        const remainder = job.compensation - baseShare * workerIds.length;
        const payouts = workerIds.map((id, index) => ({ workerId: id, amount: baseShare + (index === 0 ? remainder : 0) }));
        const completed = this.record("JOB_COMPLETED", {
          actorCharacterId: character.id,
          subjectCharacterId: job.creatorId,
          causedByEventIds: [activity.startedByEventId],
          worldTime: activity.expectedEndAt,
          data: {
            jobId: job.id, workerId: character.id, workerIds, payouts, creatorId: job.creatorId,
            title: job.title, compensation: job.compensation,
            reservationId: job.reservation.id, escrowPolicyVersion: job.reservation.policyVersion,
            processingDelayWorldMilliseconds: Math.max(0, this.clock.now() - new Date(activity.expectedEndAt)),
          },
        });
        this.record("JOB_ESCROW_SETTLED", {
          actorCharacterId: job.creatorId,
          subjectCharacterId: character.id,
          causedByEventIds: [completed.id],
          worldTime: activity.expectedEndAt,
          data: {
            jobId: job.id, reservationId: job.reservation.id,
            workerAmount: job.compensation, workerIds, payouts, refundAmount: 0,
            currency: job.reservation.currency, terminalCause: "valid_completion",
          },
        });
        for (const payout of payouts) {
          this.record("CREDITS_TRANSFERRED", {
            actorCharacterId: job.creatorId,
            subjectCharacterId: payout.workerId,
            causedByEventIds: [completed.id],
            worldTime: activity.expectedEndAt,
            data: { jobId: job.id, fromCharacterId: job.creatorId, toCharacterId: payout.workerId, amount: payout.amount },
          });
        }
      } else if (activity.type === "rest") {
        const recovered = Math.min(this.config.energy.restRecovery, this.config.energy.maximum - character.energy);
        this.record("REST_COMPLETED", {
          actorCharacterId: character.id,
          causedByEventIds: [activity.startedByEventId],
          worldTime: activity.expectedEndAt,
          data: {
            characterId: character.id, previousEnergy: character.energy,
            recoveredEnergy: recovered, energy: character.energy + recovered,
            processingDelayWorldMilliseconds: Math.max(0, this.clock.now() - new Date(activity.expectedEndAt)),
          },
        });
      } else if (activity.type === "attend_event") {
        this.record("EVENT_ATTENDANCE_ENDED", {
          actorCharacterId: character.id,
          causedByEventIds: [activity.startedByEventId],
          worldTime: activity.expectedEndAt,
          data: {
            eventId: activity.eventId, characterId: character.id, title: activity.title,
            processingDelayWorldMilliseconds: Math.max(0, this.clock.now() - new Date(activity.expectedEndAt)),
          },
        });
      }
    }
  }

  getObservation(characterId) {
    const character = this.requireCharacter(characterId);
    const nearby = character.activity?.type === "moving" ? [] : [...this.state.characters.values()]
      .filter((other) => other.id !== characterId && other.locationId === character.locationId && other.activity?.type !== "moving")
      .map((other) => ({
        id: other.id,
        name: other.name,
        relationship: this.getRelationship(characterId, other.id),
        conversationAvailability: this.conversationAvailability(character, other),
      }));
    const knownRelationships = [...this.state.relationships.entries()]
      .filter(([key]) => key.startsWith(`${characterId}->`))
      .map(([key, relationship]) => {
        const otherId = key.slice(key.indexOf("->") + 2);
        return { characterId: otherId, name: this.requireCharacter(otherId).name, ...structuredClone(relationship) };
      });
    const activeConversations = [...this.state.conversations.values()]
      .filter((conversation) => conversation.status === "active" && conversation.participantIds.includes(characterId))
      .map((conversation) => conversationObservation(conversation, this.config.conversation));
    const reflectionCutoff = addGameMinutes(this.clock.now(), -this.config.conversation.reflectionWindowWorldMinutes);
    const recentConversations = [...this.state.conversations.values()]
      .filter((conversation) => conversation.status === "ended"
        && conversation.participantIds.includes(characterId)
        && new Date(conversation.endedAt) >= reflectionCutoff
        && !this.hasConversationAppraisal(characterId, conversation.id))
      .map((conversation) => conversationObservation(conversation, this.config.conversation));
    const pendingNotifications = [...this.state.notifications.entries()]
      .filter(([, notification]) => notification.characterId === characterId && !isNotificationTerminal(notification.status))
      .map(([eventId, notification]) => ({ eventId, ...structuredClone(notification) }));
    const availableJobs = [...this.state.jobs.values()]
      .filter((job) => job.status === "open" || job.workerIds.includes(characterId) || job.fundingSourceId === characterId)
      .map((job) => publicJob(job, this.config.energy.workCost));
    const upcomingEvents = [...this.state.gatherings.values()]
      .filter((event) => new Date(event.endsAt) >= this.clock.now())
      .map((event) => ({ id: event.id, title: event.title, locationId: event.locationId, startsAt: event.startsAt, endsAt: event.endsAt }));
    const invitations = [...this.state.invitations.values()]
      .filter((invitation) => invitation.participantIds.includes(characterId))
      .map((invitation) => structuredClone(invitation));
    const commitments = [...this.state.commitments.values()]
      .filter((commitment) => commitment.participantIds.includes(characterId))
      .map((commitment) => structuredClone(commitment));

    const decision = this.getDecisionRequirement(characterId);
    return {
      worldTime: this.clock.now().toISOString(),
      rulesVersion: this.config.rules.version,
      rules: this.getAgentRules(characterId),
      stateVersion: this.characterStateVersion(characterId),
      character: publicCharacter(character),
      nearby,
      relationships: knownRelationships,
      activeConversations,
      recentConversations,
      knowledge: [...(this.state.knowledge.get(characterId)?.values() ?? [])].map((item) => structuredClone(item)),
      pendingNotifications,
      availableJobs,
      upcomingEvents,
      invitations,
      commitments,
      availableActions: this.availableActions(
        character, nearby, activeConversations, recentConversations, availableJobs, upcomingEvents,
        invitations, commitments,
      ),
      decision,
      decisionRequiredAt: decision.decisionRequiredAt,
      nextScheduledDecisionAt: decision.decisionRequiredAt,
    };
  }

  getAgentRules(characterId) {
    this.requireCharacter(characterId);
    return {
      version: this.config.rules.version,
      scope: {
        stableManifest: true,
        contextualFeasibilitySource: "observation.availableActions[*].feasibility",
        instruction: "This manifest describes stable rules; the latest observation and action submission determine contextual feasibility.",
      },
      authority: {
        serverAuthoritative: true,
        instruction: "Choose only offered actions. Dialogue may propose plans but never creates movement, work, attendance, credits, commitments, or outcomes by itself.",
      },
      time: {
        realHoursPerWorldDay: this.config.clock.realHoursPerGameDay,
        instruction: "All timestamps and durations in observations are world time unless explicitly labelled real time.",
      },
      energy: {
        maximum: this.config.energy.maximum,
        movementCost: this.config.energy.movementCost,
        workCost: this.config.energy.workCost,
        eventAttendanceCost: this.config.energy.eventAttendanceCost,
        conversationStartBaseCost: this.config.energy.socialInteractionCost,
        conversationTurnCost: this.config.energy.conversationTurnCost,
        extendedConversationTurnCost: this.config.energy.extendedConversationTurnCost,
        extendedConversationStartsAtTurn: this.config.conversation.extendedCostStartsAtTurn,
        restDurationWorldMinutes: this.config.energy.restDurationGameMinutes,
        restRecovery: this.config.energy.restRecovery,
      },
      conversations: {
        maximumTurns: this.config.conversation.maximumTurns,
        closingTurns: this.config.conversation.closingTurns,
        samePairCooldownWorldMinutes: this.config.conversation.samePairCooldownWorldMinutes,
        fatigueWindowWorldMinutes: this.config.conversation.samePairFatigueWindowWorldMinutes,
        repeatStartSurcharge: this.config.conversation.samePairRepeatStartCost,
        instruction: "Repeated conversations with the same person are temporarily blocked, then cost progressively more. Conclude once the purpose is met.",
      },
      jobs: {
        startGraceWorldHours: this.config.jobs.startGraceWorldHours,
        individualRequirements: "Every listed skill threshold must be met by the worker.",
        teamRequirements: "For team jobs the recruited team must collectively cover every listed skill threshold; compensation is split equally.",
      },
      invitations: {
        locationLeadWorldMinutes: this.config.invitations.locationLeadWorldMinutes,
        locationWindowWorldMinutes: this.config.invitations.locationWindowWorldMinutes,
        reminderWorldMinutes: this.config.invitations.reminderWorldMinutes,
        instruction: "An accepted invitation creates an authoritative commitment. Both residents must be at its location during the disclosed window.",
      },
      relationships: {
        policyVersion: this.config.relationship.policyVersion,
        affinityRange: [this.config.relationship.minimum, this.config.relationship.maximum],
        trustRange: [this.config.relationship.minimum, this.config.relationship.maximum],
        tensionRange: [this.config.relationship.tensionMinimum, this.config.relationship.tensionMaximum],
        instruction: "Relationships are private and directional. Subjective appraisals and objective outcomes are separate authoritative causes.",
      },
      goals: {
        policyVersion: this.config.goals.policyVersion,
        maximumActiveSecondaryGoals: this.config.goals.maximumActiveSecondaryGoals,
        allowedSecondaryGoalTypes: [...this.config.goals.secondaryTypes],
        instruction: "A secondary goal requires a visible causal source event and a valid known target; only authoritative evidence completes it.",
      },
      consequences: {
        instruction: "Accepted actions can change energy, credits, work state, commitments, and directional relationships. Kept and broken commitments affect trust.",
      },
    };
  }

  recordAgentRulesRequested(characterId, manifest) {
    this.requireCharacter(characterId);
    return this.record("AGENT_RULES_REQUESTED", {
      actorCharacterId: characterId,
      data: {
        characterId, rulesVersion: this.config.rules.version,
        manifestBytes: Buffer.byteLength(JSON.stringify(manifest), "utf8"),
      },
    });
  }

  recordOpportunitiesViewed(characterId, jobIds = [], eventIds = []) {
    this.requireCharacter(characterId);
    const normalizedJobIds = [...new Set(jobIds.map(String))].sort();
    const normalizedEventIds = [...new Set(eventIds.map(String))].sort();
    const previous = [...this.history].reverse().find((event) =>
      event.type === "OPPORTUNITIES_VIEWED" && event.actorCharacterId === characterId);
    if (previous
      && sameStringArray(previous.data.jobIds ?? [], normalizedJobIds)
      && sameStringArray(previous.data.eventIds ?? [], normalizedEventIds)) {
      return { recorded: false, event: structuredClone(previous) };
    }
    return {
      recorded: true,
      event: this.record("OPPORTUNITIES_VIEWED", {
        actorCharacterId: characterId,
        data: { characterId, jobIds: normalizedJobIds, eventIds: normalizedEventIds },
      }),
    };
  }

  getDecisionRequirement(characterId) {
    const character = this.requireCharacter(characterId);
    const openNotifications = [...this.state.notifications.entries()]
      .filter(([, notification]) => notification.characterId === characterId && !isNotificationTerminal(notification.status))
      .sort((a, b) => (a[1].respondByWorldTime ?? a[1].queuedAt).localeCompare(b[1].respondByWorldTime ?? b[1].queuedAt));
    if (openNotifications.length > 0) {
      const [notificationEventId, notification] = openNotifications[0];
      return {
        requiredNow: true,
        decisionRequiredAt: notification.respondByWorldTime ?? this.clock.now().toISOString(),
        reason: "relevant_event",
        notificationEventId,
      };
    }
    if (character.activity) {
      return {
        requiredNow: false,
        decisionRequiredAt: character.activity.expectedEndAt ?? null,
        reason: "activity_completion",
        notificationEventId: null,
      };
    }
    const activeConversation = [...this.state.conversations.values()].find((conversation) =>
      conversation.status === "active" && conversation.participantIds.includes(characterId));
    if (activeConversation) {
      return {
        requiredNow: false,
        decisionRequiredAt: null,
        reason: "waiting_for_event",
        notificationEventId: null,
      };
    }
    return {
      requiredNow: true,
      decisionRequiredAt: this.clock.now().toISOString(),
      reason: "idle",
      notificationEventId: null,
    };
  }

  actionResult(characterId, event, details = {}) {
    const decision = this.getDecisionRequirement(characterId);
    return {
      accepted: true,
      eventId: event.id,
      stateVersion: this.characterStateVersion(characterId),
      decisionRequiredNow: decision.requiredNow,
      decisionRequiredAt: decision.decisionRequiredAt,
      decisionReason: decision.reason,
      ...details,
    };
  }

  currentStateVersion() {
    return this.history.at(-1)?.sequence ?? this.history.length;
  }

  characterStateVersion(characterId) {
    this.requireCharacter(characterId);
    return Math.max(
      this.state.characterProjectionVersions.get(characterId) ?? 0,
      this.state.globalProjectionVersion,
    );
  }

  getCharacterHistory(characterId, limit = 100) {
    this.requireCharacter(characterId);
    return this.history.filter((event) => this.characterMayReference(characterId, event)).slice(-limit).map((event) => structuredClone(event));
  }

  getTimeline(options = {}) {
    return buildTimeline(this.history, options);
  }

  getOwnerFeed({ ownerId, characterId, cursor = null, limit = this.config.ownerFeed.defaultPageSize, cursorSecret, realNow = new Date() }) {
    requiredId(ownerId, "owner id");
    this.requireCharacter(characterId);
    if (typeof cursorSecret !== "string" || cursorSecret.length < 16) throw new Error("Owner feed cursor secret must contain at least 16 characters");
    const requestedLimit = Number(limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > this.config.ownerFeed.maximumPageSize) {
      throw invalid("INVALID_PAGE_SIZE", `Feed page size must be between 1 and ${this.config.ownerFeed.maximumPageSize}`);
    }
    const now = new Date(realNow);
    if (Number.isNaN(now.getTime())) throw invalid("INVALID_TIME", "Feed request time is invalid");
    const visibleEvents = this.history.filter((event) => this.characterMayReference(characterId, event));
    let pagination;
    if (cursor) {
      pagination = decodeOwnerCursor(cursor, cursorSecret);
      if (pagination.ownerId !== ownerId || pagination.characterId !== characterId) {
        throw new DomainError("CURSOR_SCOPE_MISMATCH", "Cursor is not valid for this owner and character scope", 403);
      }
      if (pagination.projectionVersion !== this.config.ownerFeed.authorizationProjectionVersion
        || pagination.paginationVersion !== this.config.ownerFeed.paginationContractVersion) {
        throw new DomainError("CURSOR_EXPIRED", "Cursor projection is no longer valid", 410);
      }
      if (new Date(pagination.expiresAt) <= now) throw new DomainError("CURSOR_EXPIRED", "Cursor has expired", 410);
    } else {
      const snapshotThroughSequence = visibleEvents.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
      pagination = {
        ownerId, characterId, snapshotThroughSequence,
        beforeSequence: snapshotThroughSequence + 1,
        projectionVersion: this.config.ownerFeed.authorizationProjectionVersion,
        paginationVersion: this.config.ownerFeed.paginationContractVersion,
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.config.ownerFeed.cursorTtlRealHours * 3_600_000).toISOString(),
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
      items: page.map((event) => this.ownerFeedItem(event, characterId)),
      nextCursor,
      hasMore,
      snapshotThroughSequence: pagination.snapshotThroughSequence,
    };
  }

  ownerFeedItem(event, characterId) {
    const timelineText = this.getTimeline({ characterId }).find((item) => item.id === event.id)?.text
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

  createReturnSummary({ ownerId, characterId, sinceWorldTime, throughWorldTime = this.clock.now() }) {
    requiredId(ownerId, "owner id");
    this.requireCharacter(characterId);
    const since = new Date(sinceWorldTime);
    const through = new Date(throughWorldTime);
    if (Number.isNaN(since.getTime()) || Number.isNaN(through.getTime()) || since > through) {
      throw invalid("INVALID_SUMMARY_INTERVAL", "Return summary interval is invalid");
    }
    const summaryId = createHash("sha256")
      .update(`${ownerId}|${characterId}|${since.toISOString()}|${through.toISOString()}`)
      .digest("hex").slice(0, 24);
    const existing = this.state.returnSummaries.get(summaryId);
    if (existing) return structuredClone(existing);
    const events = this.history
      .filter((event) => new Date(event.worldTime) >= since && new Date(event.worldTime) <= through)
      .filter((event) => this.characterMayReference(characterId, event) && ownerFeedTypes.has(event.type));
    const highlights = events
      .map((event) => ({ event, priority: summaryPriority(event.type) }))
      .filter((entry) => entry.priority > 0)
      .sort((a, b) => b.priority - a.priority || b.event.sequence - a.event.sequence)
      .slice(0, this.config.ownerFeed.maximumSummaryHighlights)
      .map(({ event }) => ({
        detailEventId: event.id,
        sourceEventIds: [...new Set([event.id, ...event.causedByEventIds])],
        ...this.ownerFeedItem(event, characterId),
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
    this.record("RETURN_SUMMARY_AVAILABLE", {
      actorCharacterId: characterId,
      data: { summary },
    });
    return structuredClone(summary);
  }

  viewReturnSummary(ownerId, characterId, summaryId) {
    const summary = this.state.returnSummaries.get(summaryId);
    if (!summary || summary.ownerId !== ownerId || summary.characterId !== characterId) {
      throw new DomainError("SUMMARY_NOT_FOUND", "Return summary not found", 404);
    }
    this.record("RETURN_SUMMARY_VIEWED", {
      actorCharacterId: characterId,
      data: { ownerId, characterId, summaryId },
    });
    return structuredClone(summary);
  }

  viewStoryDetail(ownerId, characterId, eventId) {
    const event = this.history.find((item) => item.id === eventId);
    if (!event || !this.characterMayReference(characterId, event)) throw new DomainError("STORY_DETAIL_NOT_FOUND", "Story detail not found", 404);
    this.record("STORY_DETAIL_VIEWED", {
      actorCharacterId: characterId,
      causedByEventIds: [event.id],
      data: { ownerId, characterId, detailEventId: event.id, ratingOffered: true },
    });
    return this.ownerFeedItem(event, characterId);
  }

  rateStory(ownerId, characterId, eventId, rating) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw invalid("INVALID_STORY_RATING", "Story rating must be an integer from 1 to 5");
    const viewKey = `${ownerId}:${characterId}:${eventId}`;
    if (!this.state.storyDetailViews.has(viewKey)) throw conflict("STORY_DETAIL_NOT_VIEWED", "Story detail must be viewed before rating");
    if (this.state.storyRatings.has(viewKey)) throw conflict("STORY_ALREADY_RATED", "This story detail was already rated");
    return this.record("STORY_INTEREST_RATED", {
      actorCharacterId: characterId,
      causedByEventIds: [eventId],
      data: { ownerId, characterId, detailEventId: eventId, rating },
    });
  }

  getProductMetrics({ fromWorldTime = null, throughWorldTime = null, environment = "development", isTest = false, testRunId = null } = {}) {
    const from = fromWorldTime ? new Date(fromWorldTime) : null;
    const through = throughWorldTime ? new Date(throughWorldTime) : null;
    if ((from && Number.isNaN(from.getTime())) || (through && Number.isNaN(through.getTime())) || (from && through && from > through)) {
      throw invalid("INVALID_METRIC_INTERVAL", "Metric interval is invalid");
    }
    const events = this.history.filter((event) => (!from || new Date(event.worldTime) >= from) && (!through || new Date(event.worldTime) <= through));
    const eventById = new Map(this.history.map((event) => [event.id, event]));
    const suppressedNotificationIds = new Set(this.history
      .filter((event) => event.type === "DEADLINE_SUPPRESSED_FOR_PLATFORM_INCIDENT")
      .map((event) => event.data.notificationEventId));
    const deliveredExpected = events.filter((event) => event.type === "AGENT_NOTIFICATION_DELIVERED")
      .filter((event) => !suppressedNotificationIds.has(event.data.notificationEventId));
    const deliveredConversation = deliveredExpected.filter((event) =>
      this.state.notifications.get(event.data.notificationEventId)?.requestKind === "conversation_response");
    const repliedNotificationIds = new Set(events
      .filter((event) => event.type === "CONVERSATION_RESPONSE_RECORDED" && event.data.outcome === "message")
      .filter((event) => {
        const notification = this.state.notifications.get(event.data.notificationEventId);
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
    const descendants = buildDescendantIndex(this.history);
    const interactionsWithConsequence = interactions.filter((root) => {
      const limit = new Date(root.worldTime).getTime() + 60 * 60_000;
      return [...(descendants.get(root.id) ?? [])].some((eventId) => {
        const event = eventById.get(eventId);
        return consequenceTypes.has(event.type) && new Date(event.worldTime).getTime() <= limit;
      });
    });
    const timeoutEvents = events.filter((event) => ["AGENT_REACTION_TIMED_OUT", "CONVERSATION_TURN_EXPIRED"].includes(event.type))
      .filter((event) => !suppressedNotificationIds.has(event.data.notificationEventId));
    const storyCandidates = projectStoryCandidates(this.history, descendants)
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
      metricDefinitionVersion: this.config.metrics.definitionVersion,
      environment,
      isTest: Boolean(isTest),
      testRunId,
      worldConfigurationVersion: this.state.activeWorldConfigurationVersion ?? this.config.metrics.worldConfigurationVersion,
      relationshipPolicyVersion: this.config.relationship.policyVersion,
      timingPolicyVersion: this.config.timing.policyVersion,
      goalsPolicyVersion: this.config.goals.policyVersion,
      escrowPolicyVersion: this.config.jobs.escrowPolicyVersion,
      rulesVersion: this.config.rules.version,
    };
    return {
      dimensions,
      interval: {
        fromWorldTime: from?.toISOString() ?? this.history[0]?.worldTime ?? null,
        throughWorldTime: through?.toISOString() ?? this.history.at(-1)?.worldTime ?? null,
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
        unavailableAgents: [...this.state.characters.values()].filter((character) => character.agentAvailability === "unavailable").length,
        deliveredNotAcknowledged: [...this.state.notifications.values()].filter((notification) => notification.status === "delivered").length,
        acknowledgedNonResponses: events.filter((event) => event.type === "AGENT_NOTIFICATION_EXPIRED"
          && this.state.notifications.get(event.data.notificationEventId)?.ackEventId).length,
        deliveryFailures: events.filter((event) => event.type === "AGENT_NOTIFICATION_DELIVERY_FAILED").length,
        deadlineProcessingDelay: delaySummary(events
          .map((event) => event.data.processingDelayWorldMilliseconds)
          .filter(Number.isFinite)),
      },
    };
  }

  getPublicState() {
    const now = this.clock.now();
    const characters = [...this.state.characters.values()].map((character) => ({
      ...publicCharacter(character),
      importantRelationships: [...this.state.characters.values()]
        .filter((other) => other.id !== character.id)
        .map((other) => ({ characterId: other.id, name: other.name, relationship: this.getRelationship(character.id, other.id) }))
        .filter((entry) => entry.relationship)
        .map((entry) => ({ ...entry, ...entry.relationship, strength: relationshipStrength(entry.relationship) }))
        .sort((a, b) => b.strength - a.strength),
    }));
    const jobs = [...this.state.jobs.values()].map((job) => publicJob(job, this.config.energy.workCost));
    const events = [...this.state.gatherings.values()].map((event) => {
      const startsAt = new Date(event.startsAt);
      const endsAt = new Date(event.endsAt);
      const status = now < startsAt ? "scheduled" : now < endsAt ? "active" : "ended";
      return {
        ...structuredClone(event),
        attendees: [...event.attendees],
        activeAttendeeIds: characters
          .filter((character) => character.activity?.type === "attend_event" && character.activity.eventId === event.id)
          .map((character) => character.id),
        status,
        durationGameMinutes: Math.round((endsAt - startsAt) / 60_000),
        energyCost: this.config.energy.eventAttendanceCost,
      };
    });
    const locations = [...this.state.locations.values()].map((location) => {
      const occupantIds = characters
        .filter((character) => character.locationId === location.id && character.activity?.type !== "moving")
        .map((character) => character.id);
      return {
        ...structuredClone(location),
        population: occupantIds.length,
        occupantIds,
        openJobCount: jobs.filter((job) => job.locationId === location.id && job.status === "open").length,
        activeEventCount: events.filter((event) => event.locationId === location.id && event.status === "active").length,
      };
    });
    const busyCharacters = characters.filter((character) => character.activity).length;
    const reservedCredits = jobs
      .filter((job) => job.reservation?.state === "reserved")
      .reduce((total, job) => total + Number(job.reservation?.amount ?? 0), 0);
    const systemBudgetBalance = [...this.state.systemBudgets.values()]
      .reduce((total, budget) => total + Number(budget.balance ?? 0), 0);
    return {
      worldTime: now.toISOString(),
      overview: {
        totalCharacters: characters.length,
        idleCharacters: characters.length - busyCharacters,
        busyCharacters,
        averageEnergy: characters.length
          ? Math.round(characters.reduce((total, character) => total + character.energy, 0) / characters.length * 10) / 10
          : 0,
        openJobs: jobs.filter((job) => job.status === "open").length,
        runningJobs: jobs.filter((job) => job.status === "running").length,
        activeEvents: events.filter((event) => event.status === "active").length,
        activeConversations: [...this.state.conversations.values()].filter((conversation) => conversation.status === "active").length,
        openInvitations: [...this.state.invitations.values()].filter((invitation) => invitation.status === "pending").length,
        scheduledCommitments: [...this.state.commitments.values()].filter((commitment) => ["scheduled", "active"].includes(commitment.status)).length,
        teamJobs: jobs.filter((job) => job.teamSize > 1).length,
        relationshipEdges: this.state.relationships.size,
        characterCredits: characters.reduce((total, character) => total + Number(character.credits ?? 0), 0),
        reservedCredits,
        systemBudgetBalance,
      },
      characters,
      locations,
      connections: [...this.state.connections.values()].map((connection) => structuredClone(connection)),
      jobs,
      events,
      invitations: [...this.state.invitations.values()].map((invitation) => structuredClone(invitation)),
      commitments: [...this.state.commitments.values()].map((commitment) => structuredClone(commitment)),
      rules: {
        version: this.config.rules.version,
        realHoursPerGameDay: this.config.clock.realHoursPerGameDay,
        maximumEnergy: this.config.energy.maximum,
        movementEnergyCost: this.config.energy.movementCost,
        workEnergyCost: this.config.energy.workCost,
        eventAttendanceEnergyCost: this.config.energy.eventAttendanceCost,
        conversationStartEnergyCost: this.config.energy.socialInteractionCost,
        conversationTurnEnergyCost: this.config.energy.conversationTurnCost,
        extendedConversationTurnEnergyCost: this.config.energy.extendedConversationTurnCost,
        extendedConversationStartsAtTurn: this.config.conversation.extendedCostStartsAtTurn,
        samePairCooldownWorldMinutes: this.config.conversation.samePairCooldownWorldMinutes,
        maximumConversationTurns: this.config.conversation.maximumTurns,
        conversationClosingTurns: this.config.conversation.closingTurns,
        restDurationGameMinutes: this.config.energy.restDurationGameMinutes,
        restRecovery: this.config.energy.restRecovery,
      },
      economy: {
        currency: this.config.jobs.currency,
        systemBudgets: [...this.state.systemBudgets.values()].map((budget) => structuredClone(budget)),
      },
      worldConfigurationVersion: this.state.activeWorldConfigurationVersion,
    };
  }

  getRelationship(fromId, toId) {
    const relationship = this.state.relationships.get(relationshipKey(fromId, toId));
    return relationship ? structuredClone(relationship) : null;
  }

  getPendingNotificationEvents(characterId) {
    return this.history.filter((event) => event.type === "AGENT_NOTIFICATION_QUEUED"
      && event.data.characterId === characterId
      && !isNotificationTerminal(this.state.notifications.get(event.id)?.status));
  }

  evaluateAndMaybeNotify(sourceEvent, observerId, context = {}) {
    const observer = this.requireCharacter(observerId);
    const actorId = sourceEvent.actorCharacterId;
    const actor = actorId ? this.requireCharacter(actorId) : null;
    const weights = this.config.relevance.weights;
    const factors = {};
    const perceptible = Boolean(context.directTarget
      || sourceEvent.data.participantIds?.includes(observerId)
      || sourceEvent.data.locationId === observer.locationId
      || (actor && actor.locationId === observer.locationId));
    if (!perceptible) {
      return this.record("RELEVANCE_EVALUATED", {
        actorCharacterId: actorId,
        subjectCharacterId: observerId,
        causedByEventIds: [sourceEvent.id],
        data: {
          characterId: observerId, sourceEventId: sourceEvent.id, score: 0, level: "NONE",
          factors: {}, perceptible: false, selectedGoal: null,
          threshold: this.config.relevance.thresholds.high, urgency: sourceEvent.data.urgency ?? "normal",
          relevanceRuleVersion: this.config.relevance.ruleVersion,
        },
      });
    }
    if (actor && actor.locationId === observer.locationId) factors.sameLocation = weights.sameLocation;
    const relationship = actor ? this.getRelationship(observerId, actorId) : null;
    if (relationship && relationshipStrength(relationship) >= 60) factors.strongRelationship = weights.strongRelationship;
    else if (relationship) factors.knownRelationship = weights.knownRelationship;
    if (context.directTarget) factors.directTarget = weights.directTarget;
    if (!observer.activity || ["work", "attend_event"].includes(observer.activity.type)) factors.compatibleActivity = weights.compatibleActivity;
    if (["CHARACTER_ARRIVED", "CONVERSATION_STARTED", "CONVERSATION_MESSAGE_SENT"].includes(sourceEvent.type)) {
      factors.importantEventType = weights.importantEventType;
    }
    const selectedGoal = this.selectRelevantGoal(observer, sourceEvent);
    if (selectedGoal) factors.goalMatch = selectedGoal.contribution;
    const score = Math.min(100, Object.values(factors).reduce((sum, value) => sum + value, 0));
    const urgency = context.urgency ?? sourceEvent.data.urgency ?? "normal";
    const level = urgency === "critical" ? "CRITICAL" : this.relevanceLevel(score);
    const evaluated = this.record("RELEVANCE_EVALUATED", {
      actorCharacterId: actorId,
      subjectCharacterId: observerId,
      causedByEventIds: [sourceEvent.id],
      data: {
        characterId: observerId, sourceEventId: sourceEvent.id, score, level, factors,
        perceptible: true, selectedGoal, threshold: this.config.relevance.thresholds.high,
        urgency, relevanceRuleVersion: this.config.relevance.ruleVersion,
      },
    });
    if (relevanceOrder.indexOf(level) >= relevanceOrder.indexOf(this.config.relevance.wakeAt)) {
      const requestKind = ["CONVERSATION_STARTED", "CONVERSATION_MESSAGE_SENT"].includes(sourceEvent.type)
        ? "conversation_response"
        : "event_reaction";
      const conversationId = sourceEvent.data.conversationId ?? null;
      const duplicate = [...this.state.notifications.values()].find((notification) =>
        notification.characterId === observerId
        && notification.requestKind === requestKind
        && conversationId
        && notification.conversationId === conversationId
        && !isNotificationTerminal(notification.status));
      if (duplicate) return evaluated;
      return this.record("AGENT_NOTIFICATION_QUEUED", {
        actorCharacterId: actorId,
        subjectCharacterId: observerId,
        causedByEventIds: [evaluated.id, sourceEvent.id],
        data: {
          characterId: observerId,
          sourceEventId: sourceEvent.id,
          level,
          urgency,
          summary: this.notificationSummary(sourceEvent),
          requestKind,
          conversationId,
          compatibleActions: requestKind === "conversation_response"
            ? ["send_message", "remain_silent", "end_conversation"]
            : ["ignore_event", "observe", "submit_intention"],
          timingPolicyVersion: this.config.timing.policyVersion,
        },
      });
    }
    return evaluated;
  }

  relevanceLevel(score) {
    const thresholds = this.config.relevance.thresholds;
    if (score >= thresholds.high) return "HIGH";
    if (score >= thresholds.medium) return "MEDIUM";
    return "LOW";
  }

  selectRelevantGoal(character, sourceEvent) {
    const candidates = [];
    if (character.primaryGoal && character.primaryGoal.status !== "inactive") candidates.push(character.primaryGoal);
    candidates.push(...character.secondaryGoals.filter((goal) => goal.status === "active"));
    return candidates
      .map((goal) => scoreGoalMatch(goal, sourceEvent))
      .filter(Boolean)
      .sort((a, b) => b.contribution - a.contribution || a.goalId.localeCompare(b.goalId))[0] ?? null;
  }

  notificationSummary(event) {
    const actorName = event.actorCharacterId ? this.requireCharacter(event.actorCharacterId).name : "The world";
    if (event.type === "CHARACTER_ARRIVED") return `${actorName} arrived at your location.`;
    if (event.type === "CONVERSATION_STARTED") return `${actorName} started a conversation with you.`;
    if (event.type === "CONVERSATION_MESSAGE_SENT") return `${actorName} sent a conversation message.`;
    return `${actorName} caused ${event.type.toLowerCase().replaceAll("_", " ")}.`;
  }

  availableActions(character, nearby, conversations, recentConversations, jobs, upcomingEvents, invitations = [], commitments = []) {
    const actions = [];
    if (!character.activity) {
      const locations = this.reachableLocations(character.locationId);
      for (const location of locations) {
        if (location.id !== character.locationId) actions.push({
          type: "move", destinationId: location.id, energyCost: this.config.energy.movementCost,
          durationGameMinutes: this.state.connections.get(`${character.locationId}->${location.id}`)?.durationGameMinutes
            ?? this.config.movement.durationGameMinutes,
        });
      }
      for (const job of jobs.filter((item) => item.status === "accepted" && item.workerIds.includes(character.id))) {
        actions.push({ type: "start_job", jobId: job.id, energyCost: this.config.energy.workCost });
        actions.push({ type: "cancel_job", jobId: job.id });
      }
      if (character.energy < this.config.energy.maximum) {
        actions.push({
          type: "rest", durationGameMinutes: this.config.energy.restDurationGameMinutes,
          expectedRecovery: Math.min(this.config.energy.restRecovery, this.config.energy.maximum - character.energy),
        });
      }
      for (const gathering of upcomingEvents) {
        if (gathering.locationId === character.locationId && new Date(gathering.startsAt) <= this.clock.now()) {
          actions.push({ type: "attend_event", eventId: gathering.id, energyCost: this.config.energy.eventAttendanceCost });
        }
      }
    }
    for (const job of jobs.filter((item) => item.status === "open")) {
      const individualUnmetRequirements = Object.entries(job.requirements ?? {})
        .filter(([skill, required]) => (character.skills?.[skill] ?? 0) < required)
        .map(([skill, required]) => ({ skill, required, actual: character.skills?.[skill] ?? 0 }));
      const teamSkillCoverageAfterJoin = job.teamSize > 1 && !job.workerIds.includes(character.id)
        ? Object.entries(job.requirements ?? {}).filter(([, required]) => required > 0).map(([skill, required]) => ({
          skill, required,
          actual: Math.max(character.skills?.[skill] ?? 0, ...job.workerIds.map((id) => this.requireCharacter(id).skills[skill] ?? 0)),
        }))
        : [];
      const unmetRequirements = job.teamSize > 1
        ? teamSkillCoverageAfterJoin.filter((item) => item.actual < item.required)
        : individualUnmetRequirements;
      actions.push({
        type: "accept_job",
        jobId: job.id,
        title: job.title,
        locationId: job.locationId,
        durationGameMinutes: job.durationGameMinutes,
        compensation: job.compensation,
        executionEnergyCost: job.energyCost,
        requirements: structuredClone(job.requirements ?? {}),
        requirementsMode: job.requirementsMode,
        teamSize: job.teamSize,
        workerIds: [...job.workerIds],
        openTeamSlots: Math.max(0, job.teamSize - job.workerIds.length),
        teamSkillCoverageAfterJoin,
        unmetRequirements,
        scheduledStartAt: job.scheduledStartAt,
        startGraceUntil: job.startGraceUntil,
        offerExpiresAt: job.offerExpiresAt,
        feasibility: this.jobAcceptanceFeasibility(
          character, job,
          job.teamSize > 1 && job.workerIds.length + 1 < job.teamSize ? [] : unmetRequirements,
        ),
      });
    }
    for (const job of jobs.filter((item) => item.fundingSourceId === character.id && ["open", "accepted"].includes(item.status))) {
      actions.push({ type: "cancel_job", jobId: job.id });
    }
    for (const job of jobs.filter((item) => item.status === "open" && item.workerIds.includes(character.id))) {
      if (!actions.some((action) => action.type === "cancel_job" && action.jobId === job.id)) {
        actions.push({ type: "cancel_job", jobId: job.id });
      }
    }
    for (const job of jobs.filter((item) => item.status === "running" && item.workerIds.includes(character.id))) {
      actions.push({ type: "cancel_job", jobId: job.id });
    }
    if (!character.activity || ["work", "attend_event"].includes(character.activity.type)) {
      for (const other of nearby) {
        const startEnergyCost = (other.conversationAvailability.startEnergyCost ?? this.config.energy.socialInteractionCost)
          + this.conversationTurnEnergyCost(0);
        actions.push({
          type: "start_conversation",
          targetCharacterId: other.id,
          energyCost: startEnergyCost,
          feasibility: character.energy >= startEnergyCost
            ? structuredClone(other.conversationAvailability)
            : { ...structuredClone(other.conversationAvailability), status: "blocked", eligible: false, blockingCode: "INSUFFICIENT_ENERGY" },
        });
      }
    }
    for (const conversation of conversations) {
      const turnEnergyCost = this.conversationTurnEnergyCost(conversation.messages.length);
      const turnFeasibility = character.energy >= turnEnergyCost
        ? { status: "eligible", blockingCode: null }
        : { status: "blocked", blockingCode: "INSUFFICIENT_ENERGY" };
      actions.push({
        type: "send_message", conversationId: conversation.id,
        energyCost: turnEnergyCost,
        turnsRemaining: conversation.turnsRemaining,
        closingRecommended: conversation.closingRecommended,
        feasibility: turnFeasibility,
      });
      actions.push({ type: "remain_silent", conversationId: conversation.id });
      actions.push({ type: "end_conversation", conversationId: conversation.id });
      if (!this.hasConversationAppraisal(character.id, conversation.id)) {
        actions.push(this.appraisalAction(character.id, conversation));
      }
    }
    for (const conversation of recentConversations) {
      actions.push(this.appraisalAction(character.id, conversation));
    }
    for (const [notificationEventId, notification] of this.state.notifications.entries()) {
      if (notification.characterId === character.id && notification.requestKind === "event_reaction" && !isNotificationTerminal(notification.status)) {
        actions.push({ type: "ignore_event", notificationEventId });
      }
    }
    for (const invitation of invitations.filter((item) => item.targetId === character.id && item.status === "pending")) {
      actions.push({
        type: "respond_invitation", invitationId: invitation.id,
        allowedResponses: ["accept", "decline"], destinationType: invitation.destinationType,
        destinationId: invitation.destinationId, locationId: invitation.locationId,
        eventId: invitation.eventId, startsAt: invitation.startsAt, endsAt: invitation.endsAt,
      });
    }
    const openSentInvitations = invitations.filter((item) =>
      item.senderId === character.id && ["pending", "accepted"].includes(item.status)).length;
    if ((!character.activity || ["work", "attend_event"].includes(character.activity.type))
      && openSentInvitations < this.config.invitations.maximumOpenPerCharacter) {
      const knownTargetIds = [...new Set([
        ...nearby.map((item) => item.id),
        ...[...this.state.relationships.keys()]
          .filter((key) => key.startsWith(`${character.id}->`))
          .map((key) => key.slice(key.indexOf("->") + 2)),
      ])];
      for (const targetCharacterId of knownTargetIds) {
        for (const location of this.state.locations.values()) {
          const startsAt = addGameMinutes(this.clock.now(), this.config.invitations.locationLeadWorldMinutes);
          actions.push({
            type: "send_invitation", targetCharacterId,
            destinationType: "location", destinationId: location.id,
            locationId: location.id, startsAt: startsAt.toISOString(),
            endsAt: addGameMinutes(startsAt, this.config.invitations.locationWindowWorldMinutes).toISOString(),
          });
        }
        for (const gathering of upcomingEvents) actions.push({
          type: "send_invitation", targetCharacterId,
          destinationType: "event", destinationId: gathering.id,
          eventId: gathering.id, locationId: gathering.locationId,
          startsAt: gathering.startsAt, endsAt: gathering.endsAt,
        });
      }
    }
    if (character.secondaryGoals.filter((goal) => goal.status === "active").length < this.config.goals.maximumActiveSecondaryGoals) {
      actions.push({ type: "propose_secondary_goal", allowedGoalTypes: [...this.config.goals.secondaryTypes] });
    }
    for (const goal of character.secondaryGoals.filter((item) => item.status === "active")) {
      actions.push({ type: "abandon_secondary_goal", goalId: goal.id });
    }
    return actions;
  }

  conversationAvailability(first, second) {
    if (first.agentAvailability === "unavailable") {
      return { status: "unavailable", eligible: false, blockingCode: "AGENT_UNAVAILABLE" };
    }
    if (second.agentAvailability === "unavailable") {
      return { status: "unavailable", eligible: false, blockingCode: "TARGET_AGENT_UNAVAILABLE" };
    }
    if ((first.activity && !["work", "attend_event"].includes(first.activity.type))
      || (second.activity && !["work", "attend_event"].includes(second.activity.type))) {
      return { status: "activity_blocked", eligible: false, blockingCode: "INTERACTION_BLOCKED" };
    }
    const occupied = [...this.state.conversations.values()].some((conversation) =>
      conversation.status === "active" && conversation.participantIds.some((id) => id === first.id || id === second.id));
    if (occupied) return { status: "occupied", eligible: false, blockingCode: "CONVERSATION_BUSY" };
    const now = this.clock.now();
    const pairConversations = [...this.state.conversations.values()]
      .filter((conversation) => conversation.status === "ended"
        && conversation.participantIds.includes(first.id)
        && conversation.participantIds.includes(second.id))
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt));
    const latest = pairConversations[0] ?? null;
    const availableAgainAt = latest
      ? addGameMinutes(new Date(latest.endedAt), this.config.conversation.samePairCooldownWorldMinutes)
      : null;
    const fatigueCutoff = addGameMinutes(now, -this.config.conversation.samePairFatigueWindowWorldMinutes);
    const recentConversationCount = pairConversations
      .filter((conversation) => new Date(conversation.endedAt) >= fatigueCutoff).length;
    const startEnergyCost = this.config.energy.socialInteractionCost
      + recentConversationCount * this.config.conversation.samePairRepeatStartCost;
    if (availableAgainAt && now < availableAgainAt) {
      return {
        status: "cooldown", eligible: false, blockingCode: "RECENT_CONVERSATION_COOLDOWN",
        availableAgainAt: availableAgainAt.toISOString(), recentConversationCount, startEnergyCost,
      };
    }
    return {
      status: recentConversationCount > 0 ? "available_with_pair_fatigue" : "available",
      eligible: true, blockingCode: null, availableAgainAt: null,
      recentConversationCount, startEnergyCost,
    };
  }

  conversationTurnEnergyCost(existingTurnCount) {
    return existingTurnCount + 1 >= this.config.conversation.extendedCostStartsAtTurn
      ? this.config.energy.extendedConversationTurnCost
      : this.config.energy.conversationTurnCost;
  }

  jobAcceptanceFeasibility(character, job, unmetRequirements) {
    const blockingCodes = [];
    if (job.creatorId === character.id) blockingCodes.push("SELF_EMPLOYMENT");
    if (character.agentAvailability === "unavailable") blockingCodes.push("AGENT_UNAVAILABLE");
    if (character.activity) blockingCodes.push("ACTIVITY_CONFLICT");
    if (character.locationId !== job.locationId) blockingCodes.push("WRONG_LOCATION");
    if (job.workerIds.includes(character.id)) blockingCodes.push("ALREADY_JOINED_TEAM");
    if (job.workerIds.length >= job.teamSize) blockingCodes.push("TEAM_FULL");
    const existingCommitment = [...this.state.jobs.values()].find((candidate) =>
      candidate.workerIds?.includes(character.id) && (candidate.status !== "open" || candidate.workerIds.length > 0));
    if (existingCommitment) blockingCodes.push("JOB_COMMITMENT_CONFLICT");
    if (this.clock.now() >= new Date(job.offerExpiresAt)) blockingCodes.push("JOB_OFFER_EXPIRED");
    else if (this.clock.now() > new Date(job.startGraceUntil)) blockingCodes.push("START_WINDOW_CLOSED");
    if (unmetRequirements.length > 0) blockingCodes.push("SKILL_REQUIREMENT");
    const uniqueBlockingCodes = [...new Set(blockingCodes)];
    return {
      status: uniqueBlockingCodes.length === 0 ? "eligible" : "blocked",
      eligible: uniqueBlockingCodes.length === 0,
      blockingCode: uniqueBlockingCodes[0] ?? null,
      blockingCodes: uniqueBlockingCodes,
    };
  }

  hasConversationAppraisal(characterId, conversationId) {
    return this.history.some((event) => event.type === "RELATIONSHIP_APPRAISAL_RECORDED"
      && event.actorCharacterId === characterId && event.data.conversationId === conversationId);
  }

  appraisalAction(characterId, conversation) {
    return {
      type: "appraise_interaction",
      conversationId: conversation.id,
      otherCharacterId: conversation.participantIds.find((id) => id !== characterId),
      conversationStatus: conversation.status,
      allowedAppraisals: {
        greeting: ["appreciated", "neutral"],
        interaction: ["appreciated", "neutral"],
        rejection: ["uncomfortable", "neutral"],
        insult: ["offended", "neutral"],
      },
    };
  }

  reachableLocations(fromLocationId) {
    if (this.state.connections.size === 0) return [...this.state.locations.values()];
    return [...this.state.connections.values()]
      .filter((connection) => connection.fromLocationId === fromLocationId)
      .map((connection) => this.requireLocation(connection.toLocationId));
  }

  minimumTravelWorldMinutes(fromLocationId, toLocationId) {
    if (fromLocationId === toLocationId) return 0;
    if (this.state.connections.size === 0) return this.config.movement.durationGameMinutes;
    const distances = new Map([[fromLocationId, 0]]);
    const pending = new Set(this.state.locations.keys());
    while (pending.size > 0) {
      const current = [...pending].sort((left, right) =>
        (distances.get(left) ?? Infinity) - (distances.get(right) ?? Infinity))[0];
      pending.delete(current);
      const distance = distances.get(current);
      if (!Number.isFinite(distance)) break;
      if (current === toLocationId) return distance;
      for (const connection of this.state.connections.values()) {
        if (connection.fromLocationId !== current || !pending.has(connection.toLocationId)) continue;
        const candidate = distance + connection.durationGameMinutes;
        if (candidate < (distances.get(connection.toLocationId) ?? Infinity)) {
          distances.set(connection.toLocationId, candidate);
        }
      }
    }
    return this.config.movement.durationGameMinutes;
  }

  nextDueItem(target, realTarget) {
    const activities = [...this.state.characters.values()]
      .filter((character) => character.activity?.expectedEndAt && new Date(character.activity.expectedEndAt) <= target)
      .map((character) => ({ kind: "activity", characterId: character.id, worldTime: character.activity.expectedEndAt }));
    const notifications = [...this.state.notifications.entries()]
      .filter(([, notification]) => !this.state.platformIncident && !isNotificationTerminal(notification.status) && notification.respondByWorldTime)
      .filter(([, notification]) => new Date(notification.respondByWorldTime) <= target
        || (notification.respondByRealTime && new Date(notification.respondByRealTime) <= realTarget))
      .map(([notificationEventId, notification]) => ({
        kind: "notification",
        notificationEventId,
        worldTime: new Date(notification.respondByWorldTime) <= target
          ? notification.respondByWorldTime
          : target.toISOString(),
      }));
    const goals = [...this.state.characters.values()].flatMap((character) => character.secondaryGoals
      .filter((goal) => goal.status === "active" && goal.expiresAt && new Date(goal.expiresAt) <= target)
      .map((goal) => ({ kind: "goal", characterId: character.id, goalId: goal.id, worldTime: goal.expiresAt })));
    const jobs = [...this.state.jobs.values()].flatMap((job) => {
      if (this.state.platformIncident) return [];
      if (job.status === "open" && new Date(job.offerExpiresAt) <= target) {
        return [{ kind: "job_offer_expiry", jobId: job.id, worldTime: job.offerExpiresAt }];
      }
      if (job.status === "accepted" && new Date(job.startGraceUntil) <= target) {
        return [{ kind: "job_no_show", jobId: job.id, worldTime: job.startGraceUntil }];
      }
      return [];
    });
    const commitments = [...this.state.commitments.values()].flatMap((commitment) => {
      if (!["scheduled", "active"].includes(commitment.status)) return [];
      if (!commitment.reminderSentAt && new Date(commitment.reminderAt) <= target) {
        return [{ kind: "commitment_reminder", commitmentId: commitment.id, worldTime: commitment.reminderAt }];
      }
      if (commitment.status === "scheduled" && new Date(commitment.startsAt) <= target) {
        return [{ kind: "commitment_start", commitmentId: commitment.id, worldTime: commitment.startsAt }];
      }
      if (new Date(commitment.endsAt) <= target) {
        return [{ kind: "commitment_deadline", commitmentId: commitment.id, worldTime: commitment.endsAt }];
      }
      return [];
    });
    return [...activities, ...notifications, ...goals, ...jobs, ...commitments]
      .sort((a, b) => a.worldTime.localeCompare(b.worldTime))[0] ?? null;
  }

  changeEnergy(characterId, delta, reason) {
    const character = this.requireCharacter(characterId);
    const value = clamp(character.energy + delta, 0, this.config.energy.maximum);
    return this.record("ENERGY_CHANGED", {
      actorCharacterId: characterId,
      data: { characterId, previous: character.energy, delta: value - character.energy, value, reason },
    });
  }

  requireEnergy(character, amount) {
    if (character.energy < amount) throw invalid("INSUFFICIENT_ENERGY", `Action requires ${amount} energy`);
  }

  requireInteractionCompatible(character) {
    if (character.activity && !["work", "attend_event"].includes(character.activity.type)) {
      throw new DomainError(
        "INTERACTION_BLOCKED",
        `Cannot interact while ${character.activity.type}`,
        409,
        { alternatives: ["wait_for_activity_completion", "remain_available_for_perceptible_events"] },
      );
    }
  }

  characterMayReference(characterId, event) {
    if (directionalRelationshipEventTypes.has(event.type)) {
      return event.data.fromId === characterId;
    }
    if (event.actorCharacterId === characterId || event.subjectCharacterId === characterId) return true;
    if (event.data?.participantIds?.includes(characterId)) return true;
    if (event.type === "EVENT_CREATED") return true;
    return false;
  }

  // Keeps characterStateVersion O(1). Without this every observation and every
  // action would rescan the whole history to find its own latest projection.
  indexProjectionVersion(event) {
    if (nonProjectionEventTypes.has(event.type)) return;
    if (event.type === "EVENT_CREATED") {
      // Perceivable by every character, including characters created later.
      this.state.globalProjectionVersion = Math.max(this.state.globalProjectionVersion, event.sequence);
      return;
    }
    for (const characterId of projectionCharactersForEvent(event)) {
      if (event.sequence > (this.state.characterProjectionVersions.get(characterId) ?? 0)) {
        this.state.characterProjectionVersions.set(characterId, event.sequence);
      }
    }
  }

  requireCharacter(id) {
    const value = this.state.characters.get(id);
    if (!value) throw new DomainError("CHARACTER_NOT_FOUND", `Character ${id} not found`, 404);
    return value;
  }

  requireLocation(id) {
    const value = this.state.locations.get(id);
    if (!value) throw new DomainError("LOCATION_NOT_FOUND", `Location ${id} not found`, 404);
    return value;
  }

  requireJob(id) {
    const value = this.state.jobs.get(id);
    if (!value) throw new DomainError("JOB_NOT_FOUND", `Job ${id} not found`, 404);
    return value;
  }

  requireGathering(id) {
    const value = this.state.gatherings.get(id);
    if (!value) throw new DomainError("EVENT_NOT_FOUND", `Event ${id} not found`, 404);
    return value;
  }

  requireConversation(id) {
    const value = this.state.conversations.get(id);
    if (!value) throw new DomainError("CONVERSATION_NOT_FOUND", `Conversation ${id} not found`, 404);
    return value;
  }

  requireInvitation(id) {
    const value = this.state.invitations.get(id);
    if (!value) throw new DomainError("INVITATION_NOT_FOUND", `Invitation ${id} not found`, 404);
    return value;
  }

  requireCommitment(id) {
    const value = this.state.commitments.get(id);
    if (!value) throw new DomainError("COMMITMENT_NOT_FOUND", `Commitment ${id} not found`, 404);
    return value;
  }

  record(type, { actorCharacterId = null, subjectCharacterId = null, data = {}, causedByEventIds = [], worldTime = null } = {}) {
    const versionedData = structuredClone(data);
    if (this.state.activeWorldConfigurationVersion && versionedData.worldConfigurationVersion === undefined) {
      versionedData.worldConfigurationVersion = this.state.activeWorldConfigurationVersion;
    }
    const event = {
      id: this.idGenerator(),
      sequence: this.history.length + 1,
      type,
      worldTime: new Date(worldTime ?? this.clock.now()).toISOString(),
      recordedAt: new Date().toISOString(),
      actorCharacterId,
      subjectCharacterId,
      causedByEventIds: [...new Set(causedByEventIds.filter(Boolean))],
      data: versionedData,
    };
    this.store.append(event);
    this.history.push(event);
    this.apply(event);
    this.events.emit("event", structuredClone(event));
    this.evaluateGoalCompletion(event);
    return event;
  }

  apply(event) {
    this.indexProjectionVersion(event);
    const data = event.data;
    switch (event.type) {
      case "LOCATION_DEFINED":
        this.state.locations.set(data.id, structuredClone(data));
        break;
      case "WORLD_CONFIGURATION_ACTIVATED":
        this.state.activeWorldConfigurationVersion = data.version;
        break;
      case "LOCATION_CONNECTION_DEFINED":
        this.state.connections.set(`${data.fromLocationId}->${data.toLocationId}`, structuredClone(data));
        break;
      case "CHARACTER_CREATED":
        this.state.characters.set(data.id, {
          ...structuredClone(data), activity: null, reputation: 0, score: 0,
          agentAvailability: "available", consecutiveMissedResponses: 0,
          secondaryGoals: [],
        });
        this.state.knowledge.set(data.id, new Map());
        break;
      case "AGENT_CREDENTIAL_CREATED":
        this.state.agentCredentials.set(data.credentialId, {
          credentialId: data.credentialId, characterId: data.characterId,
          permissions: [...data.permissions], tokenHash: data.tokenHash,
          createdAt: data.createdAt, revokedAt: null,
        });
        break;
      case "AGENT_CREDENTIAL_REVOKED":
        this.state.agentCredentials.get(data.credentialId).revokedAt = data.revokedAt;
        break;
      case "AGENT_EVENT_CHANNEL_REGISTERED":
        this.state.agentEventChannels.set(data.channelId, {
          id: data.channelId, characterId: data.characterId, transport: data.transport,
          verificationTokenHash: data.verificationTokenHash, status: data.status,
          registeredAt: data.registeredAt, registeredByEventId: event.id,
        });
        break;
      case "AGENT_EVENT_CHANNEL_VERIFIED": {
        const channel = this.state.agentEventChannels.get(data.channelId);
        channel.status = "verified";
        channel.verifiedAt = data.verifiedAt;
        break;
      }
      case "AGENT_EVENT_CHANNEL_DISABLED": {
        const channel = this.state.agentEventChannels.get(data.channelId);
        channel.status = "disabled";
        channel.disabledAt = data.disabledAt;
        channel.disabledReason = data.reason;
        break;
      }
      case "ENERGY_CHANGED":
        this.state.characters.get(data.characterId).energy = data.value;
        break;
      case "MOVEMENT_STARTED":
        this.state.characters.get(data.characterId).activity = {
          type: "moving", destinationId: data.destinationId, startedAt: data.startedAt,
          expectedEndAt: data.expectedEndAt, startedByEventId: event.id,
        };
        break;
      case "CHARACTER_ARRIVED": {
        const character = this.state.characters.get(data.characterId);
        character.locationId = data.locationId;
        character.activity = null;
        break;
      }
      case "CO_PRESENCE_STARTED":
        this.state.coPresence.set(coPresenceKey(data.participantIds[0], data.participantIds[1], data.locationId), {
          id: data.episodeId, participantIds: [...data.participantIds], locationId: data.locationId,
          startedAt: data.startedAt, interactionEligible: data.interactionEligible,
          startedByEventId: event.id,
        });
        break;
      case "CO_PRESENCE_ENDED":
        this.state.coPresence.delete(coPresenceKey(data.participantIds[0], data.participantIds[1], data.locationId));
        break;
      case "RELATIONSHIP_CREATED":
        this.state.relationships.set(relationshipKey(data.fromId, data.toId), {
          affinity: data.affinity, trust: data.trust, tension: data.tension,
          createdAt: event.worldTime, relationshipRuleVersion: data.relationshipRuleVersion,
        });
        break;
      case "RELATIONSHIP_CHANGED": {
        const key = relationshipKey(data.fromId, data.toId);
        if (data.dimension) {
          const relationship = this.state.relationships.get(key) ?? {
            affinity: 0, trust: 0, tension: 0, createdAt: event.worldTime,
            relationshipRuleVersion: data.relationshipRuleVersion,
          };
          relationship[data.dimension] = data.value;
          relationship.relationshipRuleVersion = data.relationshipRuleVersion;
          this.state.relationships.set(key, relationship);
        } else {
          // Replay compatibility for the prototype's former scalar edge.
          this.state.relationships.set(key, {
            affinity: data.value, trust: 0, tension: 0,
            createdAt: event.worldTime, relationshipRuleVersion: 1,
          });
        }
        break;
      }
      case "ECONOMY_BOOTSTRAPPED":
        this.state.systemBudgets.set(data.budgetId, {
          id: data.budgetId, initialCredits: data.credits, balance: data.credits,
          currency: data.currency, createdAt: event.worldTime,
        });
        break;
      case "JOB_CREATED": { 
        const fundingSourceType = data.fundingSourceType ?? "character";
        const fundingSourceId = data.fundingSourceId ?? data.creatorId;
        if (fundingSourceType === "system_budget") this.state.systemBudgets.get(fundingSourceId).balance -= data.compensation;
        else this.state.characters.get(fundingSourceId).credits -= data.compensation;
        const reservation = data.reservation ?? {
          id: `legacy-${data.id}`, amount: data.compensation, currency: "credits",
          originalFundingSource: { type: fundingSourceType, id: fundingSourceId },
          createdAt: event.worldTime, expiresAt: data.availableUntil,
          policyVersion: 1, state: "reserved",
        };
        this.state.jobs.set(data.id, {
          ...structuredClone(data),
          fundingSourceType, fundingSourceId,
          scheduledStartAt: data.scheduledStartAt ?? data.availableFrom,
          startGraceUntil: data.startGraceUntil ?? data.availableUntil,
          offerExpiresAt: data.offerExpiresAt ?? data.availableUntil,
          reservation: structuredClone(reservation),
          status: "open", workerId: null, workerIds: [],
          teamSize: data.teamSize ?? 1,
          requirementsMode: data.requirementsMode ?? "individual", escrow: data.compensation,
        });
        break;
      }
      case "JOB_TEAM_MEMBER_JOINED": {
        const job = this.state.jobs.get(data.jobId);
        job.workerIds = [...data.workerIds];
        job.workerId = data.workerIds[0] ?? null;
        break;
      }
      case "JOB_TEAM_MEMBER_LEFT": {
        const job = this.state.jobs.get(data.jobId);
        job.workerIds = [...data.workerIds];
        job.workerId = data.workerIds[0] ?? null;
        break;
      }
      case "JOB_ACCEPTED": {
        const job = this.state.jobs.get(data.jobId);
        job.status = "accepted";
        job.workerIds = [...(data.workerIds ?? [data.workerId])];
        job.workerId = job.workerIds[0] ?? data.workerId;
        job.acceptedAt = data.acceptedAt ?? event.worldTime;
        break;
      }
      case "JOB_STARTED": {
        const job = this.state.jobs.get(data.jobId);
        job.status = "running";
        job.workerIds = [...(data.workerIds ?? [data.workerId])];
        for (const workerId of job.workerIds) {
          const character = this.state.characters.get(workerId);
          character.activity = {
            type: "work", jobId: data.jobId, title: data.title, locationId: data.locationId,
            startedAt: data.startedAt, expectedEndAt: data.expectedEndAt, startedByEventId: event.id,
            compatibleSecondaryActions: ["start_conversation", "send_message", "end_conversation", "appraise_interaction"],
          };
        }
        break;
      }
      case "JOB_COMPLETED": {
        const job = this.state.jobs.get(data.jobId);
        job.status = "completed";
        job.escrow = 0;
        job.reservation.state = "settled";
        job.terminalCause = "valid_completion";
        job.completedAt = event.worldTime;
        const workerIds = data.workerIds ?? [data.workerId];
        const payouts = data.payouts ?? workerIds.map((workerId) => ({ workerId, amount: data.compensation / workerIds.length }));
        for (const payout of payouts) this.state.characters.get(payout.workerId).credits += payout.amount;
        for (const workerId of workerIds) this.state.characters.get(workerId).activity = null;
        break;
      }
      case "JOB_EXPIRED":
      case "JOB_CANCELLED":
      case "JOB_FAILED": {
        const job = this.state.jobs.get(data.jobId);
        job.status = data.terminalStatus;
        job.terminalCause = data.terminalCause;
        job.terminalAt = event.worldTime;
        job.escrow = 0;
        job.reservation.state = data.workerAmount > 0 ? "split" : "refunded";
        job.reservation.workerAmount = data.workerAmount;
        job.reservation.refundAmount = data.refundAmount;
        if (data.payouts?.length) {
          for (const payout of data.payouts) this.state.characters.get(payout.workerId).credits += payout.amount;
        } else if (data.workerAmount > 0 && data.workerId) this.state.characters.get(data.workerId).credits += data.workerAmount;
        if (job.fundingSourceType === "system_budget") {
          this.state.systemBudgets.get(job.fundingSourceId).balance += data.refundAmount;
        } else {
          this.state.characters.get(job.fundingSourceId).credits += data.refundAmount;
        }
        for (const workerId of data.workerIds ?? [data.workerId].filter(Boolean)) {
          const worker = this.state.characters.get(workerId);
          if (worker.activity?.jobId === data.jobId) worker.activity = null;
        }
        break;
      }
      case "REST_STARTED":
        this.state.characters.get(data.characterId).activity = {
          type: "rest", startedAt: data.startedAt, expectedEndAt: data.expectedEndAt,
          expectedRecovery: data.expectedRecovery, startedByEventId: event.id,
        };
        break;
      case "REST_COMPLETED": {
        const character = this.state.characters.get(data.characterId);
        character.energy = data.energy;
        character.activity = null;
        break;
      }
      case "EVENT_CREATED":
        this.state.gatherings.set(data.id, { ...structuredClone(data), attendees: new Set() });
        break;
      case "EVENT_ATTENDANCE_STARTED": {
        this.state.gatherings.get(data.eventId).attendees.add(data.characterId);
        this.state.characters.get(data.characterId).activity = {
          type: "attend_event", eventId: data.eventId, title: data.title,
          startedAt: data.startedAt, expectedEndAt: data.expectedEndAt, startedByEventId: event.id,
          compatibleSecondaryActions: ["start_conversation", "send_message", "end_conversation", "appraise_interaction"],
        };
        break;
      }
      case "EVENT_ATTENDANCE_ENDED":
        this.state.characters.get(data.characterId).activity = null;
        break;
      case "INVITATION_SENT":
        this.state.invitations.set(data.invitationId, {
          id: data.invitationId, ...structuredClone(data), status: "pending", sentByEventId: event.id,
        });
        break;
      case "INVITATION_ACCEPTED":
        this.state.invitations.get(data.invitationId).status = "accepted";
        this.state.invitations.get(data.invitationId).respondedAt = data.respondedAt;
        break;
      case "INVITATION_DECLINED":
        this.state.invitations.get(data.invitationId).status = "declined";
        this.state.invitations.get(data.invitationId).respondedAt = data.respondedAt;
        break;
      case "INVITATION_EXPIRED":
        this.state.invitations.get(data.invitationId).status = "expired";
        this.state.invitations.get(data.invitationId).respondedAt = event.worldTime;
        break;
      case "COMMITMENT_CREATED":
        this.state.commitments.set(data.commitmentId, {
          id: data.commitmentId, ...structuredClone(data), reminderSentAt: null,
          createdByEventId: event.id,
        });
        break;
      case "COMMITMENT_REMINDER_SENT":
        this.state.commitments.get(data.commitmentId).reminderSentAt = event.worldTime;
        break;
      case "COMMITMENT_WINDOW_OPENED":
        this.state.commitments.get(data.commitmentId).status = "active";
        break;
      case "COMMITMENT_KEPT":
        this.state.commitments.get(data.commitmentId).status = "kept";
        this.state.commitments.get(data.commitmentId).resolvedAt = event.worldTime;
        break;
      case "COMMITMENT_MISSED":
        this.state.commitments.get(data.commitmentId).status = "missed";
        this.state.commitments.get(data.commitmentId).resolvedAt = event.worldTime;
        this.state.commitments.get(data.commitmentId).presentIds = [...data.presentIds];
        this.state.commitments.get(data.commitmentId).absentIds = [...data.absentIds];
        break;
      case "CONVERSATION_STARTED":
        this.state.conversations.set(data.conversationId, {
          id: data.conversationId, initiatorId: data.initiatorId,
          participantIds: [...data.participantIds], locationId: data.locationId,
          startedAt: data.startedAt, endedAt: null, status: "active", messages: [],
          expectedResponderId: data.targetId,
          startedByEventId: event.id, lastEventId: event.id,
        });
        break;
      case "CONVERSATION_MESSAGE_SENT": {
        const conversation = this.state.conversations.get(data.conversationId);
        conversation.messages.push({
          id: data.messageId, senderId: data.senderId, text: data.text,
          sharedFacts: structuredClone(data.sharedFacts), sentAt: event.worldTime,
        });
        conversation.expectedResponderId = conversation.participantIds.find((id) => id !== data.senderId);
        conversation.lastEventId = event.id;
        break;
      }
      case "CONVERSATION_ENDED": {
        const conversation = this.state.conversations.get(data.conversationId);
        conversation.status = "ended";
        conversation.endedAt = event.worldTime;
        conversation.endReason = data.reason ?? "participant_ended";
        break;
      }
      case "KNOWLEDGE_LEARNED":
        this.state.knowledge.get(data.characterId).set(`${data.fact.id}:${data.sourceCharacterId}:${data.messageId}`, {
          ...structuredClone(data.fact), sourceCharacterId: data.sourceCharacterId,
          messageId: data.messageId, learnedAt: event.worldTime, provenance: "reported",
        });
        break;
      case "AGENT_NOTIFICATION_QUEUED":
        this.state.notifications.set(event.id, {
          characterId: data.characterId, sourceEventId: data.sourceEventId,
          level: data.level, summary: data.summary, status: "queued", queuedAt: event.worldTime,
          urgency: data.urgency ?? "normal",
          requestKind: data.requestKind ?? "event_reaction",
          conversationId: data.conversationId ?? null,
          invitationId: data.invitationId ?? null,
          commitmentId: data.commitmentId ?? null,
          compatibleActions: structuredClone(data.compatibleActions ?? []),
          timingPolicyVersion: data.timingPolicyVersion ?? 1,
          deliveryAttempts: 0,
        });
        break;
      case "AGENT_NOTIFICATION_DELIVERED": {
        const notification = this.state.notifications.get(data.notificationEventId);
        notification.status = "delivered";
        notification.deliveredEventId = event.id;
        notification.deliveredAt = data.deliveredAt;
        notification.deliveredAtReal = data.deliveredAtReal;
        notification.respondByWorldTime = data.respondByWorldTime;
        notification.respondByRealTime = data.respondByRealTime;
        notification.timingPolicyVersion = data.timingPolicyVersion;
        notification.deliveryAttempts += 1;
        break;
      }
      case "AGENT_NOTIFICATION_DELIVERY_FAILED": {
        const notification = this.state.notifications.get(data.notificationEventId);
        notification.deliveryAttempts += 1;
        notification.lastDeliveryFailureAt = event.worldTime;
        notification.lastDeliveryFailureCode = data.failureCode;
        break;
      }
      case "AGENT_NOTIFICATION_ACKNOWLEDGED": {
        const notification = this.state.notifications.get(data.notificationEventId);
        notification.status = "acknowledged";
        notification.ackEventId = event.id;
        break;
      }
      case "AGENT_NOTIFICATION_RESOLVED": {
        const notification = this.state.notifications.get(data.notificationEventId);
        notification.status = data.status;
        notification.resolutionEventId = data.resolutionEventId;
        notification.outcome = data.outcome;
        break;
      }
      case "AGENT_NOTIFICATION_EXPIRED": {
        const notification = this.state.notifications.get(data.notificationEventId);
        notification.status = "expired";
        notification.outcome = data.outcome;
        notification.expiredAt = event.worldTime;
        break;
      }
      case "AGENT_RESPONSE_MISSED": {
        const character = this.state.characters.get(data.characterId);
        character.consecutiveMissedResponses = data.consecutiveMissedResponses;
        character.agentAvailability = data.availability;
        break;
      }
      case "AGENT_RECOVERY_VERIFIED": {
        const character = this.state.characters.get(data.characterId);
        character.consecutiveMissedResponses = 0;
        character.agentAvailability = "available";
        break;
      }
      case "PLATFORM_INCIDENT_CONFIRMED":
        this.state.platformIncident = {
          id: data.incidentId, eventId: event.id,
          startedAtWorld: data.startedAtWorld, startedAtReal: data.startedAtReal,
        };
        break;
      case "PLATFORM_INCIDENT_RESOLVED":
        this.state.platformIncident = null;
        break;
      case "DEADLINE_SUPPRESSED_FOR_PLATFORM_INCIDENT": {
        const notification = this.state.notifications.get(data.notificationEventId);
        notification.respondByWorldTime = data.respondByWorldTime;
        notification.respondByRealTime = data.respondByRealTime;
        notification.lastSuppressedIncidentId = data.incidentId;
        break;
      }
      case "JOB_DEADLINE_EXTENDED_FOR_PLATFORM_INCIDENT": {
        const job = this.state.jobs.get(data.jobId);
        job.offerExpiresAt = data.offerExpiresAt;
        job.availableUntil = data.offerExpiresAt;
        job.scheduledStartAt = data.scheduledStartAt;
        job.availableFrom = data.scheduledStartAt;
        job.startGraceUntil = data.startGraceUntil;
        job.reservation.expiresAt = data.offerExpiresAt;
        break;
      }
      case "CONVERSATION_RESPONSE_RECORDED": {
        const character = this.state.characters.get(data.characterId);
        if (character.agentAvailability !== "unavailable") character.consecutiveMissedResponses = 0;
        break;
      }
      case "SECONDARY_GOAL_ADOPTED":
        this.state.characters.get(data.characterId).secondaryGoals.push(structuredClone(data.goal));
        break;
      case "SECONDARY_GOAL_COMPLETED": {
        const goal = this.state.characters.get(data.characterId).secondaryGoals.find((item) => item.id === data.goalId);
        goal.status = "completed";
        goal.completedAt = event.worldTime;
        goal.evidenceEventId = data.evidenceEventId;
        break;
      }
      case "SECONDARY_GOAL_ABANDONED": {
        const goal = this.state.characters.get(data.characterId).secondaryGoals.find((item) => item.id === data.goalId);
        goal.status = "abandoned";
        goal.abandonedAt = event.worldTime;
        break;
      }
      case "SECONDARY_GOAL_EXPIRED": {
        const goal = this.state.characters.get(data.characterId).secondaryGoals.find((item) => item.id === data.goalId);
        goal.status = "expired";
        goal.expiredAt = event.worldTime;
        break;
      }
      case "RETURN_SUMMARY_AVAILABLE":
        this.state.returnSummaries.set(data.summary.id, structuredClone(data.summary));
        break;
      case "STORY_DETAIL_VIEWED":
        this.state.storyDetailViews.add(`${data.ownerId}:${data.characterId}:${data.detailEventId}`);
        break;
      case "STORY_INTEREST_RATED":
        this.state.storyRatings.set(`${data.ownerId}:${data.characterId}:${data.detailEventId}`, data.rating);
        break;
      case "AGENT_ACTION_PROCESSED":
        this.state.actionReceipts.set(`${data.characterId}:${data.idempotencyKey}`, structuredClone(data));
        break;
    }
  }
}

function isNotificationTerminal(status) {
  return ["resolved", "expired", "cancelled"].includes(status);
}

function createEmptyState() {
  return {
    locations: new Map(), connections: new Map(), characters: new Map(), relationships: new Map(),
    conversations: new Map(), jobs: new Map(), gatherings: new Map(), coPresence: new Map(),
    invitations: new Map(), commitments: new Map(),
    notifications: new Map(), knowledge: new Map(), actionReceipts: new Map(),
    systemBudgets: new Map(), platformIncident: null,
    returnSummaries: new Map(), storyDetailViews: new Set(), storyRatings: new Map(),
    agentCredentials: new Map(), agentEventChannels: new Map(), activeWorldConfigurationVersion: null,
    characterProjectionVersions: new Map(), globalProjectionVersion: 0,
  };
}

// Mirrors characterMayReference: the characters whose projection an event advances.
// EVENT_CREATED is handled separately because it is perceivable by every character.
function projectionCharactersForEvent(event) {
  if (directionalRelationshipEventTypes.has(event.type)) {
    return event.data?.fromId ? [event.data.fromId] : [];
  }
  return [...new Set([
    event.actorCharacterId, event.subjectCharacterId,
    ...(event.data?.participantIds ?? []),
  ].filter(Boolean))];
}

function relationshipKey(fromId, toId) {
  return `${fromId}->${toId}`;
}

function coPresenceKey(firstCharacterId, secondCharacterId, locationId) {
  return `${[firstCharacterId, secondCharacterId].sort().join("<->")}@${locationId}`;
}

function timeWindowsOverlap(firstStartsAt, firstEndsAt, secondStartsAt, secondEndsAt) {
  return new Date(firstStartsAt) < new Date(secondEndsAt) && new Date(secondStartsAt) < new Date(firstEndsAt);
}

function normalizeRelationship(relationship, config) {
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

function relationshipStrength(relationship) {
  if (!relationship) return 0;
  return Math.max(Math.abs(relationship.affinity), Math.abs(relationship.trust), relationship.tension);
}

function normalizeSkills(skills) {
  const result = {};
  for (const skill of ["social", "business", "creativity", "technical"]) {
    const value = Number(skills?.[skill] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw invalid("INVALID_SKILL", `${skill} must be between 0 and 100`);
    result[skill] = value;
  }
  return result;
}

function normalizeGoal(goal, { id = goal.id, className }) {
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

function scoreGoalMatch(goal, event) {
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

function goalMatchesEvidence(goal, characterId, event) {
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

function normalizeFact(fact) {
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

function publicCharacter(character) {
  return structuredClone({
    id: character.id, name: character.name, personality: character.personality, goal: character.goal,
    primaryGoal: character.primaryGoal, secondaryGoals: character.secondaryGoals,
    locationId: character.locationId, activity: character.activity, energy: character.energy,
    credits: character.credits, skills: character.skills, reputation: character.reputation, score: character.score,
    agentAvailability: character.agentAvailability, consecutiveMissedResponses: character.consecutiveMissedResponses,
  });
}

function conversationObservation(conversation, config) {
  const copy = structuredClone(conversation);
  const turnsRemaining = Math.max(0, config.maximumTurns - copy.messages.length);
  return {
    ...copy,
    maximumTurns: config.maximumTurns,
    turnsRemaining,
    closingRecommended: turnsRemaining <= config.closingTurns,
  };
}

function publicJob(job, energyCost = null) {
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

function ownerFeedCategory(type) {
  if (["MOVEMENT_STARTED", "CHARACTER_ARRIVED", "REST_STARTED", "REST_COMPLETED", "EVENT_ATTENDANCE_STARTED", "EVENT_ATTENDANCE_ENDED"].includes(type)) return "action";
  if (["CO_PRESENCE_STARTED", "CO_PRESENCE_ENDED", "CONVERSATION_STARTED", "CONVERSATION_MESSAGE_SENT", "CONVERSATION_ENDED"].includes(type)) return "encounter";
  if (["RELATIONSHIP_CREATED", "RELATIONSHIP_CHANGED", "KNOWLEDGE_LEARNED", "SECONDARY_GOAL_ADOPTED", "SECONDARY_GOAL_COMPLETED"].includes(type)) return "consequence";
  if (type.startsWith("JOB_") || type === "EVENT_CREATED") return "opportunity";
  if (type.includes("EXPIRED") || type.includes("TIMED_OUT") || type === "SILENCE_RESOLVED" || type === "AGENT_RESPONSE_MISSED") return "agent_timeout";
  if (type === "DECISION_RECORDED") return "decision";
  return "world";
}

function ownerFeedDetails(event) {
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
  return {};
}

function summaryPriority(type) {
  if (type === "RELATIONSHIP_CHANGED") return 100;
  if (["JOB_FAILED", "JOB_COMPLETED", "SECONDARY_GOAL_COMPLETED", "SECONDARY_GOAL_ADOPTED"].includes(type)) return 90;
  if (["AGENT_REACTION_TIMED_OUT", "CONVERSATION_TURN_EXPIRED", "SILENCE_RESOLVED"].includes(type)) return 85;
  if (type === "DECISION_RECORDED") return 80;
  if (type === "KNOWLEDGE_LEARNED") return 75;
  if (type === "CONVERSATION_ENDED") return 70;
  if (["CHARACTER_ARRIVED", "CONVERSATION_STARTED"].includes(type)) return 50;
  return 0;
}

function encodeOwnerCursor(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function decodeOwnerCursor(cursor, secret) {
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

function metric(numerator, denominator) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function delaySummary(values) {
  if (values.length === 0) return { sampleCount: 0, averageWorldMilliseconds: null, maximumWorldMilliseconds: null };
  return {
    sampleCount: values.length,
    averageWorldMilliseconds: values.reduce((sum, value) => sum + value, 0) / values.length,
    maximumWorldMilliseconds: Math.max(...values),
  };
}

function buildDescendantIndex(events) {
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

function projectStoryCandidates(events, descendants) {
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

function collectActiveCharacterDays(events) {
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

function charactersForEvent(event) {
  return [...new Set([
    event.actorCharacterId, event.subjectCharacterId,
    ...(event.data.participantIds ?? []), event.data.characterId,
    event.data.fromId, event.data.toId, event.data.workerId, event.data.creatorId,
  ].filter(Boolean))];
}

function requiredId(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) {
    throw invalid("INVALID_ID", `${label} is invalid`);
  }
}

function requiredText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw invalid("INVALID_TEXT", `${label} must contain 1-${maximum} characters`);
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function addMilliseconds(value, milliseconds) {
  return new Date(new Date(value).getTime() + milliseconds).toISOString();
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalid(code, message) {
  return new DomainError(code, message, 422);
}

function conflict(code, message) {
  return new DomainError(code, message, 409);
}

function forbidden(code, message) {
  return new DomainError(code, message, 403);
}

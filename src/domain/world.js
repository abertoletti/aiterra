import { EventEmitter } from "node:events";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { addGameMinutes } from "./clock.js";
import { buildTimeline } from "./timeline.js";
import { applyEvent } from "./world-reducer.js";
import { AGENT_ACTIONS } from "./agent-actions.js";
import * as ownerProjection from "./world-owner.js";
import {
  CONTEXT_CONTRACT_VERSION, CONTEXT_MODES, CONTEXT_RESOURCES, contextSummaries, inspectCatalog,
} from "./world-context.js";
import {
  DomainError, addMilliseconds, clamp, itemsTouchedByEvent, coPresenceKey, conflict, conversationAppraisalKey,
  appraisalOutcomeKey, dominantDimension, evenPreferences, experienceAttendanceKey,
  normalizeExperienceProfile, normalizePreferences, normalizeTopics, topicFitFor,
  profileAffinity, round2, derivedTags,
  buildingCost, buildingUpkeep, courseEffectsFor, gridDistance, hostingEnergyCost, plotKey, repetitionFactor, skillGainsFor,
  conversationObservation, createEmptyState, directionalRelationshipEventTypes, forbidden,
  goalMatchesEvidence, invalid, isNotificationTerminal, nonProjectionEventTypes,
  normalizeFact, normalizeGoal, normalizeRelationship, normalizeSkills,
  projectionCharactersForEvent, publicCharacter, publicJob, relationshipKey,
  relationshipStrength, relevanceOrder, requiredId, requiredText, sameStringArray,
  scoreGoalMatch, timeWindowsOverlap,
} from "./world-support.js";

// DomainError lives with the support module but stays part of this module's
// public surface, because the server and the tests import it from here.
export { DomainError };

// Every way a job can end. A repeatable post goes back on the board after any of them,
// so a no-show or a cancellation costs the board a cooldown rather than a job.
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);

export class World {
  // `random` is injected for the same reason `idGenerator` is: the variance factor is
  // drawn in the command path and recorded on the event, so a replay must never redraw
  // it, and a test must be able to make it deterministic.
  constructor({ store, clock, config, idGenerator = randomUUID, random = Math.random }) {
    this.store = store;
    this.clock = clock;
    this.config = config;
    this.idGenerator = idGenerator;
    this.random = random;
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
      data: { characterId, notificationEventId, cursor: this.eventById(notificationEventId)?.sequence },
    });
  }

  defineLocation({ id, name, x = null, y = null, buildingId = null }) {
    requiredId(id, "location id");
    requiredText(name, "location name", this.config.city.nameMaximumLength);
    if (this.state.locations.has(id)) throw conflict("LOCATION_EXISTS", `Location ${id} already exists`);
    if (x !== null || y !== null) {
      if (!this.withinGrid(x, y)) throw invalid("OFF_GRID", `Location must sit inside the ${this.config.city.width}x${this.config.city.height} grid`);
    }
    return this.record("LOCATION_DEFINED", { data: { id, name, x, y, buildingId } });
  }

  withinGrid(x, y) {
    return Number.isInteger(x) && Number.isInteger(y)
      && x >= 1 && x <= this.config.city.width && y >= 1 && y <= this.config.city.height;
  }

  // ---- E14. The city the residents build ----------------------------------------
  //
  // Authorship is a new class of command: it mutates world structure rather than the
  // character's own state. Everything below is therefore priced, validated against the
  // controlled grammar, and idempotent through the same action receipts as every other
  // command. Free text names the place; only structured fields produce mechanics.

  // A cell is free or it is not. There is no purchase step: building claims the ground.
  plotView(x, y, characterId = null) {
    const id = plotKey(x, y);
    const plot = this.state.plots.get(id);
    const occupant = plot?.buildingId ? this.state.buildings.get(plot.buildingId) : null;
    const standing = this.locationAtCell(x, y);
    const legacyOwned = !occupant && plot?.ownerId && plot.ownerId !== characterId;
    return {
      id, x, y,
      buildingId: plot?.buildingId ?? null,
      ownerId: plot?.ownerId ?? null,
      available: !occupant && !standing && !legacyOwned,
      standingLocationId: standing?.id ?? null,
      blockers: [...(occupant ? ["PLOT_OCCUPIED"] : []), ...(standing ? ["CELL_OCCUPIED"] : []),
        ...(legacyOwned ? ["PLOT_OWNED"] : [])],
    };
  }

  // Cost and capacity are derived here and nowhere else, so a client cannot claim them
  // and the affordance cannot advertise a different price from the one charged.
  buildingQuote(profile, width, height) {
    const cells = width * height;
    const { ambition, constructionCost } = buildingCost(profile, cells, this.config.city);
    const { dailyUpkeep, upkeepPerInterval } = buildingUpkeep(constructionCost, this.config.city);
    return {
      cells, ambition, constructionCost, dailyUpkeep, upkeepPerInterval,
      capacity: cells * this.config.city.capacityPerCell,
      constructionMinutes: cells * this.config.city.constructionMinutesPerCell,
    };
  }

  // A proposal-specific, non-binding quote. Every creative and positional choice is
  // supplied by the resident; the server contributes only authoritative mechanics.
  // Nothing is reserved or charged, and construction still revalidates from scratch.
  quoteBuildingProposal(characterId, {
    x, y, width = 1, height = 1, name, description = "", profile, capabilities = [],
  }) {
    const character = this.requireCharacter(characterId);
    const city = this.config.city;
    requiredText(name, "building name", city.nameMaximumLength);
    if (!Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > city.maximumFootprintWidth || height > city.maximumFootprintHeight) {
      throw invalid("INVALID_FOOTPRINT",
        `A footprint must be between 1x1 and ${city.maximumFootprintWidth}x${city.maximumFootprintHeight}`);
    }
    const normalizedProfile = normalizeExperienceProfile(profile, this.config.grammar);
    const selected = [...new Set(capabilities)];
    for (const capability of selected) {
      if (!city.capabilities.includes(capability)) {
        throw invalid("UNKNOWN_CAPABILITY", `${capability} is not a version-${city.gridVersion} building capability`);
      }
    }
    if (selected.length === 0) throw invalid("NO_CAPABILITY", "A building must take at least one capability");

    const blockerSet = new Set();
    const plotIds = [];
    for (let dx = 0; dx < width; dx += 1) {
      for (let dy = 0; dy < height; dy += 1) {
        const cx = x + dx;
        const cy = y + dy;
        if (!this.withinGrid(cx, cy)) {
          blockerSet.add("OFF_GRID");
          continue;
        }
        const id = plotKey(cx, cy);
        plotIds.push(id);
        if (this.locationAtCell(cx, cy)) blockerSet.add("CELL_OCCUPIED");
        if (this.state.plots.get(id)?.buildingId) blockerSet.add("PLOT_OCCUPIED");
        const legacyOwner = this.state.plots.get(id)?.ownerId;
        if (legacyOwner && legacyOwner !== characterId) blockerSet.add("PLOT_OWNED");
      }
    }

    const quote = this.buildingQuote(normalizedProfile, width, height);
    if (character.credits < quote.constructionCost) blockerSet.add("INSUFFICIENT_CREDITS");
    const blockingCodes = [...blockerSet];
    const result = {
      proposal: {
        x, y, width, height,
        name: String(name).trim(),
        description: String(description).slice(0, city.descriptionMaximumLength),
        profile: normalizedProfile,
        capabilities: selected,
      },
      plotIds,
      ...quote,
      availableCredits: character.credits,
      creditsAfterConstruction: character.credits - quote.constructionCost,
      affordable: character.credits >= quote.constructionCost,
      feasibility: {
        status: blockingCodes.length ? "blocked" : "eligible",
        eligible: blockingCodes.length === 0,
        blockingCode: blockingCodes[0] ?? null,
        blockingCodes,
      },
      nonBinding: true,
      reservesNothing: true,
    };
    const event = this.record("BUILDING_QUOTE_REQUESTED", {
      actorCharacterId: characterId,
      data: {
        characterId, ...result.proposal, plotIds,
        constructionCost: quote.constructionCost,
        dailyUpkeep: quote.dailyUpkeep,
        upkeepPerInterval: quote.upkeepPerInterval,
        capacity: quote.capacity,
        constructionMinutes: quote.constructionMinutes,
        availableCredits: character.credits,
        creditsAfterConstruction: result.creditsAfterConstruction,
        blockingCodes,
      },
    });
    return { quoteEventId: event.id, ...result };
  }

  constructBuilding(characterId, {
    x, y, width = 1, height = 1, name, description = "", profile, capabilities = [],
  }) {
    const character = this.requireCharacter(characterId);
    const city = this.config.city;
    requiredText(name, "building name", city.nameMaximumLength);
    if (!Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > city.maximumFootprintWidth || height > city.maximumFootprintHeight) {
      throw invalid("INVALID_FOOTPRINT",
        `A footprint must be between 1x1 and ${city.maximumFootprintWidth}x${city.maximumFootprintHeight}`);
    }
    // The profile is what the building delivers, and it is the ceiling on every
    // experience hosted there. That is what makes it worth paying for.
    const normalizedProfile = normalizeExperienceProfile(profile, this.config.grammar);
    const selected = [...new Set(capabilities)];
    for (const capability of selected) {
      if (!city.capabilities.includes(capability)) {
        throw invalid("UNKNOWN_CAPABILITY", `${capability} is not a version-${city.gridVersion} building capability`);
      }
    }
    if (selected.length === 0) throw invalid("NO_CAPABILITY", "A building must take at least one capability");

    // Building claims the ground. A separate purchase step only let a resident fail at
    // the first move of a two-move plan: ten plots were bought in one run and not one
    // building went up, because 150 for land was affordable and 650 to build was not.
    const cellIds = [];
    for (let dx = 0; dx < width; dx += 1) {
      for (let dy = 0; dy < height; dy += 1) {
        const cx = x + dx;
        const cy = y + dy;
        if (!this.withinGrid(cx, cy)) throw invalid("OFF_GRID", "The footprint leaves the grid");
        const standing = this.locationAtCell(cx, cy);
        if (standing) throw conflict("CELL_OCCUPIED", `${standing.name} already stands on ${plotKey(cx, cy)}`);
        if (this.state.plots.get(plotKey(cx, cy))?.buildingId) {
          throw conflict("PLOT_OCCUPIED", `${plotKey(cx, cy)} already carries a building`);
        }
        const legacyOwner = this.state.plots.get(plotKey(cx, cy))?.ownerId;
        if (legacyOwner && legacyOwner !== characterId) {
          throw conflict("PLOT_OWNED", `${plotKey(cx, cy)} belongs to a legacy landowner`);
        }
        cellIds.push(plotKey(cx, cy));
      }
    }

    const quote = this.buildingQuote(normalizedProfile, width, height);
    if (character.credits < quote.constructionCost) {
      throw invalid("INSUFFICIENT_CREDITS", `Construction costs ${quote.constructionCost} credits`);
    }

    const buildingId = `building-${this.idGenerator()}`;
    const startedAt = this.clock.now();
    return this.record("BUILDING_CONSTRUCTION_STARTED", {
      actorCharacterId: characterId,
      data: {
        buildingId, proprietorId: characterId,
        name: String(name).trim(),
        description: String(description).slice(0, city.descriptionMaximumLength),
        x, y, width, height, plotIds: cellIds,
        profile: normalizedProfile,
        tags: derivedTags(normalizedProfile, this.config.grammar),
        capabilities: selected,
        capacity: quote.capacity,
        constructionCost: quote.constructionCost,
        ambition: quote.ambition,
        dailyUpkeep: quote.dailyUpkeep,
        upkeepPerInterval: quote.upkeepPerInterval,
        startedAt: startedAt.toISOString(),
        completesAt: addGameMinutes(startedAt, quote.constructionMinutes).toISOString(),
        status: "UNDER_CONSTRUCTION",
        cityGridVersion: city.gridVersion,
        grammarPolicyVersion: city.grammarPolicyVersion,
        lifecyclePolicyVersion: city.lifecyclePolicyVersion,
        lifecycleTerms: this.buildingLifecycleTerms(),
        groundClaimMode: "atomic_with_construction",
        profileTaxonomyVersion: this.config.grammar.profileTaxonomyVersion,
      },
    });
  }

  requireBuilding(buildingId) {
    const building = this.state.buildings.get(buildingId);
    if (!building) throw invalid("UNKNOWN_BUILDING", `Building ${buildingId} does not exist`);
    return building;
  }

  buildingRecoveryFeasibility(character, building) {
    const blockingCodes = [];
    if (building.proprietorId !== character.id) blockingCodes.push("NOT_PROPRIETOR");
    if (!["DELINQUENT", "INACTIVE"].includes(building.status)) blockingCodes.push("BUILDING_NOT_RECOVERABLE");
    else if (this.nextUpkeepAt(building) && this.clock.now() >= new Date(this.nextUpkeepAt(building))) {
      blockingCodes.push("UPKEEP_SETTLEMENT_PENDING");
    }
    if (character.credits < building.upkeepPerInterval) blockingCodes.push("INSUFFICIENT_CREDITS");
    return {
      status: blockingCodes.length ? "blocked" : "eligible", eligible: blockingCodes.length === 0,
      blockingCode: blockingCodes[0] ?? null, blockingCodes,
    };
  }

  reactivateBuilding(characterId, buildingId) {
    const character = this.requireCharacter(characterId);
    const building = this.requireBuilding(buildingId);
    const feasibility = this.buildingRecoveryFeasibility(character, building);
    if (!feasibility.eligible) {
      throw new DomainError(feasibility.blockingCode, "Building recovery refused", 409,
        { blockingCodes: feasibility.blockingCodes, recoveryCost: building.upkeepPerInterval });
    }
    const previousStatus = building.status;
    const paid = this.record("BUILDING_UPKEEP_PAID", {
      actorCharacterId: characterId,
      data: {
        buildingId, proprietorId: characterId, amount: building.upkeepPerInterval,
        fromProprietor: building.upkeepPerInterval, chargedAt: this.clock.now().toISOString(),
        reason: "reactivation", lifecyclePolicyVersion: this.config.city.lifecyclePolicyVersion,
        lifecycleTerms: this.buildingLifecycleTerms(building),
      },
    });
    return this.transitionBuilding(building, "ACTIVE", paid, paid.worldTime, previousStatus);
  }

  transitionBuilding(building, status, cause, worldTime, previousStatus = building.status) {
    const types = {
      ACTIVE: "BUILDING_REACTIVATED", DELINQUENT: "BUILDING_DELINQUENT",
      INACTIVE: "BUILDING_INACTIVATED", CLOSED: "BUILDING_CLOSED", ABANDONED: "BUILDING_ABANDONED",
    };
    const transition = this.record(types[status], {
      actorCharacterId: building.proprietorId, causedByEventIds: [cause.id], worldTime,
      data: {
        buildingId: building.buildingId, proprietorId: building.proprietorId, name: building.name,
        previousStatus, status, missedUpkeepIntervals: building.missedUpkeepIntervals ?? 0,
        lifecyclePolicyVersion: this.config.city.lifecyclePolicyVersion,
      },
    });
    // Superseded warnings must not remain actionable after recovery or closure.
    for (const [id, notification] of this.state.notifications) {
      if (notification.buildingId === building.buildingId && !isNotificationTerminal(notification.status)) {
        this.resolveNotification(id, status === "ACTIVE" ? "resolved" : "cancelled", transition.id, status.toLowerCase(), worldTime);
      }
    }
    if (["DELINQUENT", "INACTIVE"].includes(status)) {
      const nextStatus = status === "DELINQUENT" ? "INACTIVE" : "CLOSED";
      const terms = this.buildingLifecycleTerms(building);
      const threshold = status === "DELINQUENT" ? terms.inactiveAfterMissedUpkeepIntervals : terms.closedAfterMissedUpkeepIntervals;
      const remaining = threshold - building.missedUpkeepIntervals;
      const deadline = addGameMinutes(new Date(building.lastUpkeepAt), remaining * terms.upkeepIntervalWorldMinutes).toISOString();
      const warning = this.record("BUILDING_LIFECYCLE_WARNING", {
        actorCharacterId: building.proprietorId, causedByEventIds: [transition.id], worldTime,
        data: {
          buildingId: building.buildingId, proprietorId: building.proprietorId, name: building.name,
          status, nextStatus, transitionAt: deadline, recoveryCost: building.upkeepPerInterval,
          lifecyclePolicyVersion: this.config.city.lifecyclePolicyVersion,
        },
      });
      this.record("AGENT_NOTIFICATION_QUEUED", {
        subjectCharacterId: building.proprietorId, causedByEventIds: [warning.id], worldTime,
        data: {
          characterId: building.proprietorId, sourceEventId: warning.id, buildingId: building.buildingId,
          level: "HIGH", urgency: "normal", requestKind: "event_reaction",
          summary: `${building.name} is ${status}. Pay ${building.upkeepPerInterval} Credits with reactivate_building before ${deadline}; ${remaining} more consecutive failed upkeep payment(s) make it ${nextStatus}. Existing commitments are preserved.`,
          compatibleActions: ["reactivate_building", "ignore_event"],
          timingPolicyVersion: this.config.timing.policyVersion,
        },
      });
    }
    return transition;
  }

  // AIT-1601. The proprietor authors a night, and the building's profile is the ceiling
  // on what that night can deliver: a modest place can never host the city's great
  // music evening, and paying for one is how a proprietor earns the right to.
  hostExperience(characterId, {
    buildingId, title, description = "", profile,
    startsInGameMinutes = 0, durationGameMinutes, accessPrice = 0, capacity = null,
  }) {
    const character = this.requireCharacter(characterId);
    const building = this.requireBuilding(buildingId);
    if (building.proprietorId !== characterId) throw forbidden("NOT_PROPRIETOR", "Only the proprietor can host here");
    if (building.status !== "ACTIVE") throw conflict("BUILDING_NOT_ACTIVE", `Building is ${building.status}`);
    if (!building.capabilities.includes("host_event")) {
      throw forbidden("CAPABILITY_MISSING", "This building cannot host events");
    }
    // Omitting the profile hosts a night that delivers what the place delivers. Composing
    // one is the heaviest part of hosting, and a sensible default is the difference
    // between a proprietor hosting and a proprietor putting it off.
    const normalizedProfile = normalizeExperienceProfile(profile ?? building.profile, this.config.grammar);
    const exceeded = this.config.grammar.profileDimensions
      .filter((dimension) => (normalizedProfile[dimension] ?? 0) > (building.profile[dimension] ?? 0));
    if (exceeded.length > 0) {
      throw invalid("PROFILE_EXCEEDS_BUILDING",
        `${building.name} cannot deliver ${exceeded.join(", ")} above its own profile`);
    }
    if (accessPrice > 0 && !building.capabilities.includes("sell_access")) {
      throw forbidden("CAPABILITY_MISSING", "This building cannot charge admission");
    }
    const seats = capacity === null ? building.capacity : capacity;
    if (!Number.isInteger(seats) || seats < 1 || seats > building.capacity) {
      throw invalid("INVALID_CAPACITY", `Capacity must be between 1 and ${building.capacity}`);
    }
    if (!Number.isInteger(startsInGameMinutes) || startsInGameMinutes < 0) {
      throw invalid("INVALID_SCHEDULE", "startsInGameMinutes must be a non-negative whole number");
    }
    if (!Number.isInteger(durationGameMinutes) || durationGameMinutes < 1) {
      throw invalid("INVALID_DURATION", "An experience must last at least one world minute");
    }
    // Putting a night on is work. Hosting was free, and the pilot's only proprietor answered
    // by creating five events in nine real minutes, two of them three seconds apart, every
    // one at her building's ceiling - because an announcement that costs nothing is worth
    // making again immediately. Charged on the same ambition the building was priced on, so
    // a modest evening can be thrown often and a lavish one exhausts whoever throws it.
    const startsAt = addGameMinutes(this.clock.now(), startsInGameMinutes);
    const endsAt = addGameMinutes(startsAt, durationGameMinutes);
    // One night at a time. A room seats what it seats and a proprietor can only run one
    // thing at once, so two experiences sharing a building and an hour is not a richer
    // programme - it is the same crowd counted twice, and in the pilot it was four
    // overlapping nights in a room for ten. The clash names the night already booked, so
    // the fix is to pick another slot rather than to guess.
    const clash = [...this.state.gatherings.values()].find((gathering) =>
      gathering.buildingId === buildingId
      && timeWindowsOverlap(startsAt, endsAt, gathering.startsAt, gathering.endsAt));
    if (clash) {
      throw conflict("BUILDING_ALREADY_BOOKED",
        `${building.name} is already hosting ${clash.title} until ${clash.endsAt}`);
    }
    const energyCost = hostingEnergyCost(normalizedProfile, this.config.experience);
    this.requireEnergy(character, energyCost);
    const energyEvent = this.changeEnergy(characterId, -energyCost, "hosting");
    return this.createEvent({
      causedByEventIds: [energyEvent.id],
      creatorId: characterId,
      title, description,
      locationId: building.locationId,
      startsAt,
      endsAt,
      profile: normalizedProfile,
      accessPrice,
      capacity: seats,
      buildingId,
      // Admission is the proprietor's own income: it is credited straight to the owner's
      // wallet, tagged with the building so a per-venue revenue ledger survives. The
      // building itself holds no separate purse.
      accessDestinationType: "building",
      accessDestinationId: buildingId,
    });
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
    skills = {},
    preferences = null,
  }) {
    requiredId(id, "character id");
    requiredText(name, "character name", 80);
    // A character may be created before it has decided where to live. Arriving with no
    // square is the first decision the brain makes rather than a fact the operator writes
    // down for it, and a null location is excluded from every spatial rule by construction:
    // it matches no square, so no co-presence, no neighbour and no board ever finds it.
    if (locationId !== null && locationId !== undefined) this.requireLocation(locationId);
    if (this.state.characters.has(id)) throw conflict("CHARACTER_EXISTS", `Character ${id} already exists`);
    if (!Array.isArray(personality) || personality.length > this.config.protocol.maximumPersonalityTraits) {
      throw invalid("INVALID_PERSONALITY", `Personality must contain at most ${this.config.protocol.maximumPersonalityTraits} traits`);
    }
    if (!Number.isFinite(energy) || energy < 0 || energy > this.config.energy.maximum) throw invalid("INVALID_ENERGY", "Invalid starting energy");
    if (!Number.isFinite(credits) || credits < 0) throw invalid("INVALID_CREDITS", "Invalid starting credits");

    const created = this.record("CHARACTER_CREATED", {
      actorCharacterId: id,
      data: {
        id,
        name,
        locationId: locationId ?? null,
        personality: personality.map((trait) => String(trait).slice(0, 80)),
        goal: String(goal).slice(0, 500),
        primaryGoal: primaryGoal ? normalizeGoal(primaryGoal, { id: `primary-${id}`, className: "primary" }) : null,
        energy,
        credits,
        skills: normalizeSkills(skills, this.config.skills.set),
        happiness: this.config.happiness.initial,
        livedHappiness: 0,
        preferences: preferences
          ? normalizePreferences(preferences, this.config.grammar)
          : evenPreferences(this.config.grammar),
        profileTaxonomyVersion: this.config.grammar.profileTaxonomyVersion,
        happinessPolicyVersion: this.config.happiness.policyVersion,
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

  // Experience and Happiness policy v1. Bounded, server-owned, and saturating toward
  // the range ends so no sequence of experiences can pin a character at 0 or 100.
  changeHappiness(characterId, rawDelta, reason, { causedByEventIds = [], worldTime = null, factors = null, lived = true } = {}) {
    const character = this.requireCharacter(characterId);
    const policy = this.config.happiness;
    const bounded = clamp(rawDelta, -policy.maximumChangePerExperience, policy.maximumChangePerExperience);
    const applied = bounded > 0
      ? Math.round(bounded * (policy.maximum - character.happiness) / policy.maximum)
      : Math.round(bounded * character.happiness / policy.maximum);
    const value = clamp(character.happiness + applied, policy.minimum, policy.maximum);
    return this.record("HAPPINESS_CHANGED", {
      actorCharacterId: characterId,
      causedByEventIds,
      worldTime,
      data: {
        characterId, reason, value, previous: character.happiness,
        rawDelta: bounded, appliedDelta: value - character.happiness,
        // Happiness is two quantities. The state says how good life is now, so it is
        // bounded and saturates. livedHappiness is the unbounded total of what was
        // actually lived, which is what a run is won on: a wonderful evening at 95
        // barely moves the state and still counts in full toward the total.
        lived, livedDelta: lived ? bounded : 0,
        ...(factors ? { factors } : {}),
        happinessPolicyVersion: policy.policyVersion,
      },
    });
  }

  // AIT-1504. One authoritative command: it settles the access offer, charges entry
  // Energy, and creates presence. A failure leaves no payment and no presence.
  joinExperience(characterId, eventId, { expectedHappiness = null } = {}) {
    const character = this.requireCharacter(characterId);
    const gathering = this.requireGathering(eventId);
    const price = gathering.accessPrice ?? 0;
    if (expectedHappiness !== null
      && (!Number.isInteger(expectedHappiness)
        || Math.abs(expectedHappiness) > this.config.happiness.maximumChangePerExperience)) {
      throw invalid(
        "INVALID_EXPECTED_HAPPINESS",
        `Expected Happiness must be an integer between ${-this.config.happiness.maximumChangePerExperience} and ${this.config.happiness.maximumChangePerExperience}`,
      );
    }
    const previous = this.state.experienceAttendance.get(experienceAttendanceKey(eventId, characterId));
    if (previous && !previous.resolved && expectedHappiness !== null
      && expectedHappiness !== (previous.expectedHappiness ?? null)) {
      throw conflict("EXPECTATION_IMMUTABLE", "Expected Happiness cannot be added or revised after entry");
    }
    // Everything is decided by the one shared computation the affordance and the catalog
    // also read, so this command can only refuse what they already disclosed.
    const feasibility = this.eventAttendanceFeasibility(character, gathering);
    if (!feasibility.eligible) {
      const code = feasibility.blockingCode;
      if (code === "BUILDING_NOT_ACTIVE") throw conflict(code, "The building cannot admit new attendees while inactive");
      if (code === "ACTIVITY_CONFLICT") throw conflict("ACTIVITY_CONFLICT", `Cannot attend while ${character.activity.type}`);
      if (code === "INSUFFICIENT_ENERGY") throw invalid("INSUFFICIENT_ENERGY", `Attendance requires ${this.config.experience.entryEnergyCost} energy`);
      if (code === "WRONG_LOCATION") throw invalid("WRONG_LOCATION", "Character must be at the experience location");
      if (code === "EXPERIENCE_FULL") throw conflict("EXPERIENCE_FULL", "The experience has reached its capacity");
      if (code === "INSUFFICIENT_CREDITS") throw invalid("INSUFFICIENT_CREDITS", `Admission costs ${price} credits`);
      throw invalid("EVENT_NOT_ACTIVE", "Experience is not active");
    }
    // Re-entry inside the window does not repeat the initial participation cost.
    const now = this.clock.now();
    const reEntry = Boolean(previous && !previous.resolved && previous.endedAt
      && (now - new Date(previous.endedAt)) <= this.config.experience.reEntryWindowWorldMinutes * 60_000);
    const entryEnergyCost = reEntry ? 0 : this.config.experience.entryEnergyCost;

    const causedByEventIds = [];
    if (price > 0) {
      const paid = this.record("EXPERIENCE_ACCESS_PAID", {
        actorCharacterId: characterId,
        data: {
          characterId, eventId, price,
          destinationType: gathering.accessDestinationType ?? "system_budget",
          destinationId: gathering.accessDestinationId ?? this.config.economy.bootstrapBudgetId,
          experienceCommercePolicyVersion: this.config.experience.commercePolicyVersion,
        },
      });
      causedByEventIds.push(paid.id);
    }
    if (entryEnergyCost > 0) {
      causedByEventIds.push(this.changeEnergy(characterId, -entryEnergyCost, "experience_entry").id);
    }
    const attendanceStarted = this.record("EVENT_ATTENDANCE_STARTED", {
      actorCharacterId: characterId,
      causedByEventIds,
      data: {
        eventId, characterId, title: gathering.title, locationId: gathering.locationId,
        startedAt: now.toISOString(), expectedEndAt: gathering.endsAt,
        price, reEntry, entryEnergyCost,
        expectedHappiness: previous && !previous.resolved
          ? (previous.expectedHappiness ?? null)
          : expectedHappiness,
        experienceEnergyPolicyVersion: this.config.experience.energyPolicyVersion,
      },
    });
    if (expectedHappiness !== null && !(previous && !previous.resolved)) {
      this.record("EXPERIENCE_EXPECTATION_DECLARED", {
        actorCharacterId: characterId,
        causedByEventIds: [attendanceStarted.id],
        data: {
          characterId, eventId, expectedHappiness,
          attendanceStartedByEventId: attendanceStarted.id,
          happinessPolicyVersion: this.config.happiness.policyVersion,
        },
      });
    }
    return attendanceStarted;
  }

  // AIT-1504. Leaving is authoritative and is what triggers settlement, so a resident
  // cannot avoid the duration charge or the participation factor by walking out.
  stayExperience(characterId, eventId) {
    const character = this.requireCharacter(characterId);
    if (character.activity?.type !== "attend_event" || character.activity.eventId !== eventId) {
      throw conflict("NOT_ATTENDING", "Character is not currently attending that experience");
    }
    const nextDecisionAt = new Date(Math.min(new Date(character.activity.expectedEndAt).getTime(),
      addGameMinutes(this.clock.now(), this.config.experience.decisionIntervalWorldMinutes).getTime())).toISOString();
    return this.record("EXPERIENCE_STAYED", {
      actorCharacterId: characterId, data: { characterId, eventId, nextDecisionAt },
    });
  }

  leaveExperience(characterId, eventId) {
    const character = this.requireCharacter(characterId);
    this.requireGathering(eventId);
    if (character.activity?.type !== "attend_event" || character.activity.eventId !== eventId) {
      throw conflict("NOT_ATTENDING", "Character is not currently attending that experience");
    }
    return this.endExperienceAttendance(characterId, eventId, "departure");
  }

  // The single resolution point the Energy and Happiness policies share: departure,
  // experience end, or terminal cancellation, whichever comes first.
  endExperienceAttendance(characterId, eventId, cause, worldTime = null) {
    const gathering = this.requireGathering(eventId);
    const attendance = this.state.experienceAttendance.get(experienceAttendanceKey(eventId, characterId));
    const at = worldTime ? new Date(worldTime) : this.clock.now();
    const presenceMinutes = attendance
      ? attendance.accruedMinutes + Math.max(0, Math.round((at - new Date(attendance.startedAt)) / 60_000))
      : 0;

    const ended = this.record("EVENT_ATTENDANCE_ENDED", {
      actorCharacterId: characterId,
      worldTime: at.toISOString(),
      data: { eventId, characterId, cause, endedAt: at.toISOString(), presenceMinutes },
    });

    // Marginal presence Energy, charged once against a measured interval.
    const marginal = Math.min(
      this.config.experience.marginalEnergyMaximum,
      Math.floor(presenceMinutes / this.config.experience.marginalEnergyPerWorldMinutes),
    );
    if (marginal > 0) {
      this.changeEnergy(characterId, -marginal, "experience_duration", { allowFloor: true, causedByEventIds: [ended.id], worldTime: at.toISOString() });
    }
    this.resolveExperienceHappiness(characterId, gathering, { presenceMinutes, cause, causedByEventIds: [ended.id], worldTime: at.toISOString() });
    return ended;
  }

  // AIT-1505. Every factor comes from what actually happened, never from what was
  // announced. Resolution is once per attendance.
  resolveExperienceHappiness(characterId, gathering, { presenceMinutes, cause, causedByEventIds = [], worldTime }) {
    const character = this.requireCharacter(characterId);
    const policy = this.config.happiness;
    const grammar = this.config.grammar;
    const profile = gathering.profile ?? null;
    const attendanceKey = experienceAttendanceKey(gathering.id, characterId);
    const attendance = this.state.experienceAttendance.get(attendanceKey);
    if (attendance?.resolved) return null;

    // An experience with no authored profile produces no experiential value: there is
    // nothing to compare a preference against, and inventing a default would be the
    // server deciding what the gathering meant.
    if (!profile) return null;

    const affinityValue = profileAffinity(character.preferences, profile, grammar);
    const affinity = clamp(
      (affinityValue - policy.affinityPivot) * policy.affinityScale,
      policy.affinityMinimum, policy.affinityMaximum,
    );

    const others = this.overlappingAttendees(gathering.id, characterId);
    // Presence is the small factor and interaction is the large one. Being in a room
    // with someone you value is worth something; talking to them is worth much more.
    // Without that gap a resident could farm Happiness by standing near people.
    const presenceValue = clamp(
      others.reduce((total, otherId) => {
        const relationship = this.getRelationship(characterId, otherId);
        return total + (relationship ? (relationship.affinity - relationship.tension) / policy.presenceValueDivisor : 0);
      }, 0),
      -policy.presenceValueBound, policy.presenceValueBound,
    );

    const plannedMinutes = Math.max(1, Math.round((new Date(gathering.endsAt) - new Date(gathering.startsAt)) / 60_000));
    const share = presenceMinutes / plannedMinutes;
    const participation = policy.participationBands
      .find((band) => band.belowShare === null || share < band.belowShare).value;

    const interactionDetail = this.socialInteractionValue(character, attendance, gathering);
    const interaction = interactionDetail.value;

    const capacity = gathering.capacity ?? null;
    const crowd = capacity === null
      ? clamp(others.length - 1, -policy.crowdBound, policy.crowdBound)
      : clamp(Math.round((others.length / capacity) * policy.crowdFillScale) - policy.crowdFillOffset,
        -policy.crowdBound, policy.crowdBound);

    const repetition = repetitionFactor(
      this.similarPriorAttendances(characterId, gathering, worldTime), policy);

    // Drawn once, here, and recorded below. Two residents with identical preferences at
    // the identical gathering do not come away with identical evenings — but the
    // breakdown still sums to the raw delta, so nothing becomes unexplainable.
    const variance = round2((this.random() * 2 - 1) * policy.varianceBound);

    const factors = {
      affinity: round2(affinity),
      presenceValue: round2(presenceValue),
      interaction,
      participation,
      crowd,
      repetition: round2(repetition),
      variance,
      affinityValue: round2(affinityValue),
      presenceMinutes,
      plannedMinutes,
      coPresentCount: others.length,
      // The per-person breakdown is what makes an evening explainable: who it was, how
      // much was said, and how it went.
      interactionDetail: interactionDetail.perPerson,
      profileTaxonomyVersion: grammar.profileTaxonomyVersion,
    };
    const raw = affinity + presenceValue + interaction + participation + crowd + repetition + variance;

    const expectedHappiness = Number.isInteger(attendance?.expectedHappiness)
      ? attendance.expectedHappiness
      : null;
    const realizedHappiness = round2(clamp(raw, -policy.maximumChangePerExperience, policy.maximumChangePerExperience));
    const resolved = this.record("EXPERIENCE_HAPPINESS_RESOLVED", {
      actorCharacterId: characterId,
      causedByEventIds: [
        ...causedByEventIds,
        attendance?.expectationDeclaredByEventId,
      ].filter(Boolean),
      worldTime,
      data: {
        characterId, eventId: gathering.id, locationId: gathering.locationId, cause,
        rawDelta: realizedHappiness,
        expectedHappiness,
        realizedMinusExpected: expectedHappiness === null ? null : round2(realizedHappiness - expectedHappiness),
        expectationDeclaredByEventId: attendance?.expectationDeclaredByEventId ?? null,
        attendanceStartedByEventId: attendance?.startedByEventId ?? null,
        factors,
        dominantDimension: dominantDimension(profile, grammar),
        happinessPolicyVersion: policy.policyVersion,
      },
    });
    this.changeHappiness(characterId, raw, "experience_resolved", {
      causedByEventIds: [resolved.id], worldTime, factors,
    });
    // AIT-1202: a hosted night that resolved well is the organizer's verified outcome -
    // presence-measured attendance, never an announced guest list. Only a guest's positive
    // resolution counts, the host's own never does, and the per-gathering repetition key
    // caps what one night can pay however many guests it drew.
    if (gathering.creatorId && gathering.creatorId !== characterId
      && this.state.characters.has(gathering.creatorId) && resolved.data.rawDelta > 0) {
      this.applyReputationOutcome(gathering.creatorId, {
        cause: "experience_hosted", role: "organizer", sourceEventId: resolved.id,
        repetitionKey: `experience_hosted:${gathering.id}`, worldTime,
      });
    }
    return resolved;
  }

  // SocialValue = Σ intensity × importance × outcome × novelty × topicFit, per person.
  // Five turns with someone who matters, that went well, about something you care
  // about, is a different evening from five turns of small talk with a stranger — and
  // an argument with someone who matters makes the evening worse, not merely flat.
  socialInteractionValue(character, attendance, gathering) {
    const policy = this.config.happiness;
    const perPerson = [];
    for (const [otherId, detail] of Object.entries(attendance?.interactions ?? {})) {
      const relationship = this.getRelationship(character.id, otherId);
      // Saturating per person: the first real exchange is worth most, the fifth little.
      const intensity = 1 - Math.exp(-policy.interactionSaturationK * detail.turns);
      // Someone you feel strongly about matters more, in either direction. A stranger
      // still counts for something, which is what makes meeting people worthwhile.
      const importance = relationship
        ? clamp(
          policy.strangerImportance
            + (Math.abs(relationship.affinity) + relationship.tension) / policy.importanceDivisor,
          policy.strangerImportance, 1,
        )
        : policy.strangerImportance;
      const outcome = policy.interactionOutcomes[appraisalOutcomeKey(detail)]
        ?? policy.interactionOutcomes.unappraised;
      // Meeting someone new is worth more than the hundredth exchange with a regular.
      const novelty = relationship ? 1 : policy.firstMeetingNovelty;
      // Point 9: interaction quality without a server-side classifier. The speaker
      // declares what was discussed from the controlled taxonomy; this character's own
      // preferences decide whether it landed.
      const topicFit = topicFitFor(character.preferences, detail.topics, policy);
      perPerson.push({
        otherId, turns: detail.turns, appraisal: detail.appraisal ?? null,
        topics: [...(detail.topics ?? [])],
        value: round2(policy.interactionValueMaximum * intensity * importance * outcome * novelty * topicFit),
      });
    }
    const total = perPerson.reduce((sum, entry) => sum + entry.value, 0);
    return {
      value: round2(clamp(total, -policy.interactionValueMaximum, policy.interactionValueMaximum)),
      perPerson,
    };
  }

  currentAttendeeCount(eventId) {
    let count = 0;
    for (const character of this.state.characters.values()) {
      if (character.activity?.type === "attend_event" && character.activity.eventId === eventId) count += 1;
    }
    return count;
  }

  // Residents whose attendance actually overlapped this character's, which is what
  // makes social value depend on presence rather than on an announced guest list.
  overlappingAttendees(eventId, characterId) {
    const mine = this.state.experienceAttendance.get(experienceAttendanceKey(eventId, characterId));
    if (!mine) return [];
    const from = new Date(mine.startedAt);
    const to = mine.endedAt ? new Date(mine.endedAt) : this.clock.now();
    const others = [];
    for (const [key, other] of this.state.experienceAttendance) {
      if (!key.startsWith(`${eventId}:`) || other.characterId === characterId) continue;
      const otherFrom = new Date(other.startedAt);
      const otherTo = other.endedAt ? new Date(other.endedAt) : this.clock.now();
      if (otherFrom < to && from < otherTo) others.push(other.characterId);
    }
    return [...new Set(others)];
  }

  // Repetition is the one realized factor derived from private history rather than from
  // something visible in the world, so a brain that cannot see it would be surprised by
  // a penalty it had no way to anticipate. Reuses the resolution's own count.
  repetitionOutlook(characterId, gathering) {
    const policy = this.config.happiness;
    const priorSimilarAttendances = this.similarPriorAttendances(characterId, gathering, null);
    return {
      priorSimilarAttendances,
      // How much of the free run is disclosed with the count, so a brain can tell "my
      // fourth night here is still free" from "the next one starts costing".
      freeAttendances: policy.repetitionFreeAttendances,
      windowWorldDays: policy.repetitionWindowWorldDays,
      factor: round2(repetitionFactor(priorSimilarAttendances, policy)),
    };
  }

  similarPriorAttendances(characterId, gathering, worldTime) {
    const policy = this.config.happiness;
    const since = new Date(new Date(worldTime ?? this.clock.now()).getTime()
      - policy.repetitionWindowWorldDays * 24 * 60 * 60_000);
    const dominant = dominantDimension(gathering.profile, this.config.grammar);
    return (this.state.happinessResolutions.get(characterId) ?? []).filter((prior) =>
      new Date(prior.worldTime) >= since
      && (prior.locationId === gathering.locationId || (dominant && prior.dominantDimension === dominant))).length;
  }

  // A building someone built is a venue, not a public room. It admits the city when it has
  // something on - and for the time it takes to walk there beforehand, so a resident can set
  // out before the doors open rather than always arriving after the start. When nothing is
  // programmed the place is shut, which is what makes an idle building cost its proprietor
  // instead of quietly serving as free shelter. The building and its whole bill stay visible
  // either way: a closed door is something to plan around, not something to hide.
  buildingDoorState(locationId, at = this.clock.now()) {
    const location = this.state.locations.get(locationId);
    const building = location?.buildingId ? this.state.buildings.get(location.buildingId) : null;
    if (!building) return { isVenue: false, open: true, opensAt: null, eventId: null, title: null };
    if (building.status !== "ACTIVE") return {
      isVenue: true, open: false, opensAt: null, eventId: null, title: null,
      proprietorId: building.proprietorId, lifecycleStatus: building.status,
    };
    const moment = new Date(at);
    const lead = this.config.city.doorsOpenBeforeWorldMinutes;
    let open = false;
    let next = null;
    for (const gathering of this.state.gatherings.values()) {
      if (gathering.buildingId !== building.buildingId) continue;
      if (new Date(gathering.endsAt) < moment) continue;
      const opensAt = addGameMinutes(new Date(gathering.startsAt), -lead);
      if (opensAt <= moment) { open = true; next = { opensAt, gathering }; break; }
      if (!next || opensAt < next.opensAt) next = { opensAt, gathering };
    }
    return {
      isVenue: true,
      open,
      proprietorId: building.proprietorId,
      opensAt: next ? next.opensAt.toISOString() : null,
      eventId: next?.gathering.id ?? null,
      title: next?.gathering.title ?? null,
    };
  }

  // The first thing a resident does is choose where to begin. It is not a walk - nobody is
  // crossing the city, they are stepping into it - so it costs no Energy and takes no time.
  // A venue is not a place to start: the city admits you to its public squares.
  enterWorld(characterId, locationId) {
    const character = this.requireCharacter(characterId);
    if (character.locationId) throw conflict("ALREADY_ARRIVED", "This character is already in the world");
    const square = this.requireLocation(locationId);
    if (square.buildingId) throw invalid("NOT_A_PUBLIC_SQUARE", "A resident arrives in a public square, not inside someone's building");
    const arrived = this.record("CHARACTER_ENTERED_WORLD", {
      actorCharacterId: characterId,
      data: { characterId, locationId, name: character.name },
    });
    // Arriving is being seen. Whoever is already standing there meets a new resident.
    for (const observer of this.state.characters.values()) {
      if (observer.id === characterId || observer.locationId !== locationId) continue;
      if (observer.activity?.type === "moving") continue;
      this.startCoPresence(characterId, observer.id, locationId, arrived.id);
      this.evaluateAndMaybeNotify(arrived, observer.id);
    }
    return arrived;
  }

  startMove(characterId, destinationId, { vehicleId = null } = {}) {
    const character = this.requireCharacter(characterId);
    // You cannot walk somewhere from nowhere. A resident who has not chosen a square has to
    // enter the world before it can cross it.
    if (!character.locationId) throw conflict("NOT_IN_THE_WORLD", "Choose a square with enter_world before moving");
    this.requireLocation(destinationId);
    if (character.locationId === destinationId) throw invalid("ALREADY_THERE", "Character is already at that location");
    if (character.activity) throw conflict("ACTIVITY_CONFLICT", `Cannot move while ${character.activity.type}`);
    const doors = this.buildingDoorState(destinationId);
    if (doors.isVenue && !doors.open && !this.mayEnterClosedVenue(characterId, destinationId, doors)) {
      throw conflict("BUILDING_CLOSED", doors.opensAt
        ? `The venue is closed; it opens at ${doors.opensAt} for ${doors.title}`
        : "The venue is closed and has nothing programmed");
    }
    this.requireEnergy(character, this.config.energy.movementCost);

    const options = this.travelOptionsBetween(character, character.locationId, destinationId);
    if (options === null) throw invalid("UNREACHABLE_DESTINATION", "Destination is not reachable from the current location");
    // How to travel is the rider's call, per trip: on foot unless a garage vehicle is
    // named. A named ride must be owned and its wear payable - both were stated on the
    // affordance, so this refusal can only confirm what was already disclosed.
    const chosen = vehicleId === null || vehicleId === undefined
      ? options[0]
      : options.find((option) => option.vehicleId === vehicleId);
    if (!chosen) throw invalid("VEHICLE_NOT_OWNED", `${vehicleId} is not in this character's garage`);
    if (!chosen.affordable) throw invalid("INSUFFICIENT_CREDITS", `Riding the ${vehicleId} costs ${chosen.usageCost} credits of wear`);
    const energyEvent = this.changeEnergy(characterId, -this.config.energy.movementCost, "movement");
    const expectedEndAt = addGameMinutes(this.clock.now(), chosen.minutes).toISOString();
    const movement = this.record("MOVEMENT_STARTED", {
      actorCharacterId: characterId,
      causedByEventIds: [energyEvent.id],
      data: {
        characterId,
        fromLocationId: character.locationId,
        destinationId,
        durationGameMinutes: chosen.minutes,
        // The chosen ride and its wear.
        ...(chosen.vehicleId ? {
          vehicleId: chosen.vehicleId, vehicleUsageCost: chosen.usageCost, walkMinutes: options[0].minutes,
        } : {}),
        startedAt: this.clock.now().toISOString(),
        expectedEndAt,
      },
    });
    this.endCoPresenceForCharacter(characterId, movement.id);
    this.endActiveConversations(characterId, "departure", movement.id);
    return movement;
  }

  // The proprietor always gets in: someone has to be able to open up. So does anyone
  // employed or enrolled there - a venue that hires staff or sells a course and then locks
  // them out could never be staffed or attended, and the notice they answered was pinned in
  // a public square precisely because nobody can stand inside a place that is shut. Decided
  // in one place, because the move affordance and the move command must not disagree about
  // who a closed door stops.
  mayEnterClosedVenue(characterId, locationId, doors = this.buildingDoorState(locationId)) {
    if (doors.proprietorId === characterId) return true;
    const employedHere = [...this.state.jobs.values()].some((job) =>
      job.locationId === locationId
      && job.workerIds?.includes(characterId)
      && !TERMINAL_JOB_STATUSES.has(job.status));
    if (employedHere) return true;
    const committedHere = [...this.state.commitments.values()].some((commitment) =>
      commitment.locationId === locationId && commitment.participantIds.includes(characterId)
      && ["scheduled", "active"].includes(commitment.status));
    if (committedHere) return true;
    const enrollment = this.activeCourseEnrollmentFor(characterId);
    return Boolean(enrollment && this.state.courses.get(enrollment.courseId)?.locationId === locationId);
  }

  fundingBalance(type, id) {
    if (type === "system_budget") {
      const budget = this.state.systemBudgets.get(id);
      if (!budget) return 0;
      return budget.unlimited ? Number.POSITIVE_INFINITY : budget.balance;
    }
    // A building's purse is its proprietor's wallet: wages are funded from, and refunded
    // to, the owner's own credits.
    if (type === "building") {
      const proprietorId = this.state.buildings.get(id)?.proprietorId;
      return this.state.characters.get(proprietorId)?.credits ?? 0;
    }
    return this.state.characters.get(id)?.credits ?? 0;
  }

  // AIT-1602. A proprietor employs people out of their own wallet, and pins the
  // notice in a square rather than inside the premises - because a board is read by whoever
  // is standing at it, and nobody is standing inside a venue that is shut. The work happens
  // at the building; only the advertisement lives in the square.
  publishRole(characterId, {
    buildingId, boardLocationId, title, description = "", requirements = {},
    reputationRequirements = {}, durationGameMinutes, wage, teamSize = 1, id = this.idGenerator(),
  }) {
    const proprietor = this.requireCharacter(characterId);
    const building = this.requireBuilding(buildingId);
    if (building.proprietorId !== characterId) throw forbidden("NOT_PROPRIETOR", "Only the proprietor can employ here");
    if (building.status !== "ACTIVE") throw conflict("BUILDING_NOT_ACTIVE", `Building is ${building.status}`);
    if (!building.capabilities.includes("create_job")) {
      throw forbidden("CAPABILITY_MISSING", "This building cannot publish roles");
    }
    const board = this.requireLocation(boardLocationId);
    // A notice pinned inside the premises would be unreadable: the venue is shut whenever
    // nothing is on, so nobody could ever be standing there to read it.
    if (board.buildingId) throw invalid("BOARD_NOT_PUBLIC", "A role must be advertised on a public square, not inside a building");
    if (!Number.isFinite(wage) || wage <= 0) throw invalid("INVALID_COMPENSATION", "A wage must be positive");
    if (proprietor.credits < wage) {
      throw conflict("INSUFFICIENT_CREDITS",
        `${proprietor.name} holds ${proprietor.credits} and the wage is ${wage}`);
    }
    return this.publishJob({
      id, creatorId: characterId,
      fundingSourceType: "building", fundingSourceId: buildingId,
      title, description,
      // Read in the square, worked at the building.
      locationId: building.locationId, boardLocationId,
      durationGameMinutes, compensation: wage, requirements, teamSize,
      // AIT-1202/1603: a role may demand a demonstrated track record in a controlled
      // domain, not just a skill level - the first mechanical rule reputation feeds.
      reputationRequirements: this.normalizeReputationRequirements(reputationRequirements),
      // A resident-created role is filled by application and selection, never taken off
      // the board: employment must stay a two-sided choice (AIT-1603).
      hiring: "application",
      availableCredits: proprietor.credits, visibility: "public",
    });
  }

  normalizeReputationRequirements(requirements) {
    const result = {};
    for (const [domain, minimum] of Object.entries(requirements ?? {})) {
      if (!this.config.skills.set.includes(domain)) {
        throw invalid("UNKNOWN_REPUTATION_DOMAIN",
          `${domain} is not a version-${this.config.reputation.domainTaxonomyVersion} reputation domain`);
      }
      const value = Number(minimum);
      if (!Number.isFinite(value) || value < this.config.reputation.minimum || value > this.config.reputation.maximum) {
        throw invalid("INVALID_REPUTATION_REQUIREMENT",
          `${domain} reputation requirement must be between ${this.config.reputation.minimum} and ${this.config.reputation.maximum}`);
      }
      if (value > 0) result[domain] = value;
    }
    return result;
  }

  // ---- AIT-1205. Courses: the priced way into a skill you cannot yet work in ---------
  //
  // Work teaches only what it demands (skillGainsFor), so a resident below every rung on
  // its own board can never climb there. A course closes exactly that gap: its mechanical
  // effects come from the approved catalog in config, a provider only chooses the entry,
  // the skill, the price inside the entry's band, and where the notice hangs.

  requireCourse(id) {
    const course = this.state.courses.get(id);
    if (!course) throw new DomainError("COURSE_NOT_FOUND", `Course ${id} not found`, 404);
    return course;
  }

  courseCatalogEntry(catalogEntryId) {
    const entry = this.config.courses.catalog.find((item) => item.id === catalogEntryId);
    if (!entry) throw invalid("UNKNOWN_COURSE_TEMPLATE", `${catalogEntryId} is not in the approved course catalog`);
    return entry;
  }

  // One study commitment at a time, mirroring the one-job rule: a resident who has paid
  // tuition and accepted a shift has promised to be in two places, and the world does not
  // referee that race.
  activeCourseEnrollmentFor(characterId) {
    return [...this.state.courseEnrollments.values()].find((enrollment) =>
      enrollment.characterId === characterId && ["enrolled", "started"].includes(enrollment.status)) ?? null;
  }

  offerCourse({
    id = this.idGenerator(), providerType, providerId, buildingId = null,
    locationId, boardLocationId, catalogEntryId, skill, tradeoffSkill = null,
    price, title, description = "",
  }) {
    requiredId(id, "course id");
    requiredText(title, "course title", 120);
    if (this.state.courses.has(id)) throw conflict("COURSE_EXISTS", `Course ${id} already exists`);
    const entry = this.courseCatalogEntry(catalogEntryId);
    if (!this.config.skills.set.includes(skill)) throw invalid("INVALID_SKILL", `${skill} is not a version-${this.config.skills.policyVersion} skill`);
    if (entry.tradeoffLoss) {
      if (!this.config.skills.set.includes(tradeoffSkill) || tradeoffSkill === skill) {
        throw invalid("INVALID_TRADEOFF_SKILL", "A specialization names a distinct skill from the controlled set to pay its cost in");
      }
    } else if (tradeoffSkill) {
      throw invalid("INVALID_TRADEOFF_SKILL", `${catalogEntryId} carries no tradeoff to assign a skill to`);
    }
    if (!Number.isInteger(price) || price < entry.priceMinimum || price > entry.priceMaximum) {
      throw invalid("INVALID_COURSE_PRICE", `${catalogEntryId} must be priced between ${entry.priceMinimum} and ${entry.priceMaximum}`);
    }
    this.requireLocation(locationId);
    const board = this.requireLocation(boardLocationId);
    // Same rule as roles: a notice inside a venue that is shut when nothing is on is a
    // notice nobody can ever be standing at.
    if (board.buildingId) throw invalid("BOARD_NOT_PUBLIC", "A course is advertised on a public square, not inside a building");
    if (providerType === "city" && !this.state.systemBudgets.has(providerId)) {
      throw new DomainError("BUDGET_NOT_FOUND", `System budget ${providerId} not found`, 404);
    }
    return this.record("COURSE_OFFERED", {
      actorCharacterId: providerType === "resident" ? providerId : null,
      data: {
        id, title, description: String(description).slice(0, 500),
        providerType, providerId, buildingId,
        locationId, boardLocationId,
        catalogEntryId, skill, tradeoffSkill,
        gain: entry.gain, teachesTo: entry.teachesTo,
        prerequisites: entry.prerequisite ? { [skill]: entry.prerequisite } : {},
        tradeoffLoss: entry.tradeoffLoss,
        price, durationGameMinutes: entry.durationGameMinutes, energyCost: entry.energyCost,
        // Tuition funds the venue the way admission does, or returns to the treasury that
        // seeded the course; either way the reducer moves it, so the books reconcile.
        feeDestinationType: buildingId ? "building" : "system_budget",
        feeDestinationId: buildingId ?? providerId,
        schedule: { type: "on_demand", startGraceWorldHours: this.config.courses.startGraceWorldHours },
        tuition: { paidAt: "enrolment", refundOnCancel: 0, refundOnAbandon: 0, refundOnNoShow: 0 },
        coursePolicyVersion: this.config.courses.policyVersion,
        courseCatalogVersion: this.config.courses.catalogVersion,
        skillPolicyVersion: this.config.skills.policyVersion,
      },
    });
  }

  // A resident teaches in its own building: the second way a place earns, after admission.
  offerResidentCourse(characterId, { buildingId, boardLocationId, catalogEntryId, skill, tradeoffSkill = null, price, title, description = "" }) {
    this.requireCharacter(characterId);
    const building = this.requireBuilding(buildingId);
    if (building.proprietorId !== characterId) throw forbidden("NOT_PROPRIETOR", "Only the proprietor can teach here");
    if (building.status !== "ACTIVE") throw conflict("BUILDING_NOT_ACTIVE", `Building is ${building.status}`);
    if (!building.capabilities.includes("sell_service")) {
      throw forbidden("CAPABILITY_MISSING", "Teaching for tuition is a sold service; this building cannot sell services");
    }
    const openHere = [...this.state.courses.values()].filter((course) =>
      course.buildingId === buildingId && course.status === "open").length;
    if (openHere >= this.config.courses.maximumOpenCoursesPerBuilding) {
      throw conflict("COURSE_LIMIT_REACHED",
        `A building may keep at most ${this.config.courses.maximumOpenCoursesPerBuilding} courses on offer`);
    }
    return this.offerCourse({
      providerType: "resident", providerId: characterId, buildingId,
      // Taught at the building, advertised on a square: read where people stand, attended
      // where the provider built.
      locationId: building.locationId, boardLocationId,
      catalogEntryId, skill, tradeoffSkill, price, title, description,
    });
  }

  // Everything the enrol command refuses is decided here, so the affordance, the catalog
  // and the command cannot disagree. Energy is deliberately absent: it is charged at the
  // start of class, and a tired resident can rest between paying and sitting down.
  courseEnrollmentFeasibility(character, course) {
    const blockingCodes = [];
    if (course.status !== "open") blockingCodes.push("COURSE_CLOSED");
    if (course.buildingId && this.requireBuilding(course.buildingId).status !== "ACTIVE") blockingCodes.push("BUILDING_NOT_ACTIVE");
    if (character.agentAvailability === "unavailable") blockingCodes.push("AGENT_UNAVAILABLE");
    if (character.activity) blockingCodes.push("ACTIVITY_CONFLICT");
    if (character.locationId !== course.boardLocationId) blockingCodes.push("WRONG_LOCATION");
    if (this.activeCourseEnrollmentFor(character.id)) blockingCodes.push("ENROLLMENT_CONFLICT");
    if (this.activeCommitmentFor(character.id)) blockingCodes.push("JOB_COMMITMENT_CONFLICT");
    for (const [skill, minimum] of Object.entries(course.prerequisites ?? {})) {
      if ((character.skills?.[skill] ?? 0) < minimum) { blockingCodes.push("PREREQUISITE_NOT_MET"); break; }
    }
    if (character.credits < course.price) blockingCodes.push("INSUFFICIENT_CREDITS");
    return {
      status: blockingCodes.length === 0 ? "eligible" : "blocked",
      eligible: blockingCodes.length === 0,
      blockingCode: blockingCodes[0] ?? null,
      blockingCodes,
    };
  }

  courseStartFeasibility(character, course, enrollment) {
    const blockingCodes = [];
    if (!enrollment || enrollment.status !== "enrolled") blockingCodes.push("NOT_ENROLLED");
    else if (this.clock.now() > new Date(enrollment.startBy)) blockingCodes.push("START_WINDOW_CLOSED");
    if (character.agentAvailability === "unavailable") blockingCodes.push("AGENT_UNAVAILABLE");
    if (character.activity) blockingCodes.push("ACTIVITY_CONFLICT");
    if (character.locationId !== course.locationId) blockingCodes.push("WRONG_LOCATION");
    if (character.energy < course.energyCost) blockingCodes.push("INSUFFICIENT_ENERGY");
    return {
      status: blockingCodes.length === 0 ? "eligible" : "blocked",
      eligible: blockingCodes.length === 0,
      blockingCode: blockingCodes[0] ?? null,
      blockingCodes,
    };
  }

  // The whole notice, for this reader: provider, terms, and the exact effects completion
  // would apply to these skills. Disclosed before enrolment, because a price discovered by
  // being refused is a price we taught the agent to guess.
  courseView(character, course) {
    return {
      courseId: course.id,
      title: course.title,
      description: course.description || null,
      providerType: course.providerType,
      providerId: course.providerId,
      buildingId: course.buildingId,
      locationId: course.locationId,
      boardLocationId: course.boardLocationId,
      price: course.price,
      durationGameMinutes: course.durationGameMinutes,
      energyCost: course.energyCost,
      prerequisites: structuredClone(course.prerequisites ?? {}),
      effects: courseEffectsFor(course, character.skills, this.config.skills),
      schedule: structuredClone(course.schedule),
      tuition: structuredClone(course.tuition),
      startGraceWorldHours: this.config.courses.startGraceWorldHours,
      feasibility: this.courseEnrollmentFeasibility(character, course),
    };
  }

  // One authoritative event pays the tuition and creates the commitment, so no failure can
  // leave half of either, and an idempotent resubmission cannot charge twice.
  enrollInCourse(characterId, courseId) {
    const character = this.requireCharacter(characterId);
    const course = this.requireCourse(courseId);
    const feasibility = this.courseEnrollmentFeasibility(character, course);
    if (!feasibility.eligible) {
      const code = feasibility.blockingCode;
      if (code === "COURSE_CLOSED") throw conflict("COURSE_CLOSED", "The course is no longer offered");
      if (code === "BUILDING_NOT_ACTIVE") throw conflict(code, "The building cannot sell new enrolments while inactive");
      if (code === "AGENT_UNAVAILABLE") throw conflict("AGENT_UNAVAILABLE", "Unavailable agents cannot enrol");
      if (code === "ACTIVITY_CONFLICT") throw conflict("ACTIVITY_CONFLICT", `Cannot enrol while ${character.activity.type}`);
      if (code === "WRONG_LOCATION") throw invalid("WRONG_LOCATION", "Character must be at the notice board to enrol");
      if (code === "ENROLLMENT_CONFLICT") throw conflict("ENROLLMENT_CONFLICT", "Character already holds a course enrolment");
      if (code === "JOB_COMMITMENT_CONFLICT") throw conflict("JOB_COMMITMENT_CONFLICT", "Character is already committed to a job");
      if (code === "PREREQUISITE_NOT_MET") throw invalid("PREREQUISITE_NOT_MET", "The course prerequisites are not met");
      throw invalid("INSUFFICIENT_CREDITS", `Tuition costs ${course.price} credits`);
    }
    const enrolledAt = this.clock.now();
    return this.record("COURSE_ENROLLED", {
      actorCharacterId: characterId,
      data: {
        enrollmentId: this.idGenerator(), courseId, characterId,
        title: course.title, price: course.price,
        feeDestinationType: course.feeDestinationType, feeDestinationId: course.feeDestinationId,
        enrolledAt: enrolledAt.toISOString(),
        startBy: addGameMinutes(enrolledAt, this.config.courses.startGraceWorldHours * 60).toISOString(),
        effects: courseEffectsFor(course, character.skills, this.config.skills),
        coursePolicyVersion: this.config.courses.policyVersion,
        courseCatalogVersion: course.courseCatalogVersion,
      },
    });
  }

  startCourse(characterId, courseId) {
    const character = this.requireCharacter(characterId);
    const course = this.requireCourse(courseId);
    const enrollment = this.activeCourseEnrollmentFor(characterId);
    if (!enrollment || enrollment.courseId !== courseId || enrollment.status !== "enrolled") {
      throw conflict("NOT_ENROLLED", "Character holds no open enrolment for that course");
    }
    if (this.clock.now() > new Date(enrollment.startBy)) {
      this.expireCourseEnrollment(enrollment.id, enrollment.startBy);
      throw conflict("START_WINDOW_CLOSED", "The disclosed start window has closed");
    }
    if (character.agentAvailability === "unavailable") throw conflict("AGENT_UNAVAILABLE", "Unavailable agents cannot start a course");
    if (character.activity) throw conflict("ACTIVITY_CONFLICT", `Cannot start a course while ${character.activity.type}`);
    if (character.locationId !== course.locationId) throw invalid("WRONG_LOCATION", "Character must be at the course location to start");
    this.requireEnergy(character, course.energyCost);
    const energyEvent = this.changeEnergy(characterId, -course.energyCost, "course");
    const startedAt = this.clock.now();
    const started = this.record("COURSE_STARTED", {
      actorCharacterId: characterId,
      causedByEventIds: [energyEvent.id, enrollment.enrolledByEventId],
      data: {
        enrollmentId: enrollment.id, courseId, characterId,
        title: course.title, locationId: course.locationId,
        startedAt: startedAt.toISOString(),
        expectedEndAt: addGameMinutes(startedAt, course.durationGameMinutes).toISOString(),
        energyCost: course.energyCost,
      },
    });
    this.endActiveConversations(characterId, "incompatible_activity", started.id);
    return started;
  }

  // Cancelling before the start and walking out of class end the same way: the enrolment is
  // terminal, the tuition stays where it went, and no effect applies. All three exits were
  // disclosed on the notice before a credit moved.
  abandonCourse(characterId, courseId) {
    this.requireCharacter(characterId);
    this.requireCourse(courseId);
    const enrollment = this.activeCourseEnrollmentFor(characterId);
    if (!enrollment || enrollment.courseId !== courseId) {
      throw conflict("NOT_ENROLLED", "Character holds no open enrolment for that course");
    }
    return this.record("COURSE_ABANDONED", {
      actorCharacterId: characterId,
      causedByEventIds: [enrollment.enrolledByEventId],
      data: {
        enrollmentId: enrollment.id, courseId, characterId,
        cause: enrollment.status === "started" ? "abandoned_after_start" : "cancelled_before_start",
        feeForfeited: enrollment.price,
      },
    });
  }

  expireCourseEnrollment(enrollmentId, worldTime) {
    const enrollment = this.state.courseEnrollments.get(enrollmentId);
    if (!enrollment || enrollment.status !== "enrolled") return null;
    return this.record("COURSE_ABANDONED", {
      actorCharacterId: enrollment.characterId,
      causedByEventIds: [enrollment.enrolledByEventId],
      worldTime,
      data: {
        enrollmentId, courseId: enrollment.courseId, characterId: enrollment.characterId,
        cause: "start_window_missed", feeForfeited: enrollment.price,
      },
    });
  }

  createJob({ creatorId, id = this.idGenerator(), title, locationId, durationGameMinutes, compensation, requirements = {}, energyCost = null, teamSize = 1, availableFrom, availableUntil, scheduledStartAt, offerExpiresAt, repeatable = false, cooldownGameMinutes = null }) {
    const creator = this.requireCharacter(creatorId);
    return this.publishJob({
      id, creatorId, fundingSourceType: "character", fundingSourceId: creatorId,
      title, locationId, durationGameMinutes, compensation, requirements, energyCost, teamSize,
      scheduledStartAt: scheduledStartAt ?? availableFrom,
      offerExpiresAt: offerExpiresAt ?? availableUntil,
      availableCredits: creator.credits,
      visibility: "public", repeatable, cooldownGameMinutes,
    });
  }

  // An unlimited city is the honest shape for the only source of new money in the world.
  // A very large number is a bug that has not happened yet: it eventually empties, and the
  // failure is silent - posts simply stop reopening and nothing says why. Declared instead,
  // so escrow is always covered and what matters is how much the city has put in, not what
  // it has left.
  bootstrapEconomy({
    budgetId = this.config.economy.bootstrapBudgetId,
    credits = this.config.economy.bootstrapCredits,
    unlimited = this.config.economy.unlimitedCityBudget,
  } = {}) {
    requiredId(budgetId, "budget id");
    if (this.state.systemBudgets.has(budgetId)) return null;
    if (!unlimited && (!Number.isFinite(credits) || credits < 0)) {
      throw invalid("INVALID_CREDITS", "Bootstrap credits must be non-negative");
    }
    return this.record("ECONOMY_BOOTSTRAPPED", {
      data: { budgetId, credits: unlimited ? 0 : credits, unlimited, currency: this.config.jobs.currency },
    });
  }

  createSystemJob({ budgetId = this.config.economy.bootstrapBudgetId, id = this.idGenerator(), title, locationId, durationGameMinutes, compensation, requirements = {}, energyCost = null, teamSize = 1, scheduledStartAt, offerExpiresAt, repeatable = false, cooldownGameMinutes = null }) {
    const budget = this.state.systemBudgets.get(budgetId);
    if (!budget) throw new DomainError("BUDGET_NOT_FOUND", `System budget ${budgetId} not found`, 404);
    const openSystemJobs = [...this.state.jobs.values()].filter((job) =>
      job.fundingSourceType === "system_budget" && ["open", "accepted", "running"].includes(job.status)).length;
    if (openSystemJobs >= this.config.economy.maximumOpenSystemJobs) {
      throw conflict("SYSTEM_JOB_LIMIT", "The maximum number of active system-funded jobs has been reached");
    }
    return this.publishJob({
      id, creatorId: null, fundingSourceType: "system_budget", fundingSourceId: budgetId,
      title, locationId, durationGameMinutes, compensation, requirements, energyCost, teamSize,
      scheduledStartAt, offerExpiresAt, availableCredits: this.fundingBalance("system_budget", budgetId),
      visibility: "public", repeatable, cooldownGameMinutes,
    });
  }

  publishJob({ id, creatorId, fundingSourceType, fundingSourceId, title, description = null, locationId, boardLocationId = null, durationGameMinutes, compensation, requirements, reputationRequirements = {}, hiring = "direct_accept", energyCost = null, teamSize = 1, scheduledStartAt, offerExpiresAt, availableCredits, visibility, repeatable = false, cooldownGameMinutes = null }) {
    // createJob and createSystemJob always generate one, but a direct call without an
    // id silently created a job keyed `undefined`, which nothing could ever reach.
    requiredId(id, "job id");
    this.requireLocation(locationId);
    requiredText(title, "job title", 120);
    if (!Number.isFinite(compensation) || compensation <= 0) throw invalid("INVALID_COMPENSATION", "Compensation must be positive");
    if (availableCredits < compensation) throw invalid("INSUFFICIENT_CREDITS", "Funding source cannot fund job escrow");
    if (!Number.isFinite(durationGameMinutes) || durationGameMinutes <= 0) throw invalid("INVALID_DURATION", "Job duration must be positive");
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > this.config.jobs.maximumTeamSize) {
      throw invalid("INVALID_TEAM_SIZE", `Team size must be between 1 and ${this.config.jobs.maximumTeamSize}`);
    }
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
        description,
        locationId,
        // Where the notice is pinned, when that is not where the work happens.
        boardLocationId: boardLocationId ?? locationId,
        durationGameMinutes,
        // Effort is a property of the work, not of the world. Every post used to cost the
        // same 15 whatever it was, so a five-minute errand and an hour of skilled labour
        // were indistinguishable to a resident deciding what to spend its day on.
        energyCost: energyCost ?? this.config.energy.workCost,
        compensation,
        requirements: normalizeSkills(requirements, this.config.skills.set),
        reputationRequirements: structuredClone(reputationRequirements),
        hiring,
        teamSize,
        requirementsMode: teamSize > 1 ? "team_coverage" : "individual",
        visibility,
        publishedAt: publishedAt.toISOString(),
        scheduledStartAt: start.toISOString(),
        startGraceUntil: startGraceUntil.toISOString(),
        offerExpiresAt: expires.toISOString(),
        availableFrom: start.toISOString(),
        availableUntil: expires.toISOString(),
        // A standing post rather than a one-off offer: it goes on cooldown when someone
        // finishes it and comes back, so the board never empties and a resident can earn
        // its way to a building instead of racing an expiry.
        repeatable,
        cooldownGameMinutes: repeatable
          ? (cooldownGameMinutes ?? this.config.jobs.repeatCooldownGameMinutes)
          : null,
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
    if (job.fundingSourceType === "building" && this.requireBuilding(job.fundingSourceId).status !== "ACTIVE") {
      throw conflict("BUILDING_NOT_ACTIVE", "The building cannot take new work commitments");
    }
    // A resident-created role is a two-sided choice: the candidate applies and the
    // proprietor selects. Taking it off the board would let the fastest reader bypass
    // the one decision reputation exists to inform (AIT-1603).
    if (job.hiring === "application") {
      throw conflict("ROLE_REQUIRES_APPLICATION", "This role is filled by application; apply_for_role and wait to be selected");
    }
    if (job.creatorId === workerId) throw conflict("SELF_EMPLOYMENT", "A character cannot accept its own funded job");
    if (worker.agentAvailability === "unavailable") throw conflict("AGENT_UNAVAILABLE", "Unavailable agents cannot accept new jobs");
    if (worker.activity) throw conflict("ACTIVITY_CONFLICT", `Cannot accept a job while ${worker.activity.type}`);
    // You take a notice off the board you are standing at; you go to the site to do it.
    // These were the same place until a proprietor could advertise a job inside a venue that
    // is shut whenever nothing is on - and then requiring presence at the site to accept
    // made such a role unacceptable by anyone.
    const boardLocationId = job.boardLocationId ?? job.locationId;
    if (worker.locationId !== boardLocationId) {
      throw invalid("WRONG_LOCATION", "Character must be at the notice board to accept it");
    }
    if (job.workerIds.includes(workerId)) throw conflict("ALREADY_JOINED_TEAM", "Character already joined this job");
    const existingCommitment = this.activeCommitmentFor(workerId);
    if (existingCommitment) throw conflict("JOB_COMMITMENT_CONFLICT", `Character is already committed to job ${existingCommitment.id}`);
    if (this.activeCourseEnrollmentFor(workerId)) throw conflict("COURSE_COMMITMENT_CONFLICT", "Character is already committed to a course");
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

  // ---- AIT-1603. Applications: employment as a two-sided choice ----------------------
  //
  // A resident-created role is not taken, it is applied for: candidates declare interest
  // at the board, and the proprietor's brain selects among them before the deadline. This
  // is the first decision that reads reputation - without a chooser, a track record is a
  // number nobody consults.

  pendingApplications(job) {
    return (job.applications ?? []).filter((application) => application.status === "pending");
  }

  unmetReputationRequirements(character, job) {
    return Object.entries(job.reputationRequirements ?? {})
      .filter(([domain, minimum]) => (character.domainReputation?.[domain] ?? 0) < minimum)
      .map(([domain, minimum]) => ({ domain, required: minimum, actual: character.domainReputation?.[domain] ?? 0 }));
  }

  // Applying commits nothing - a candidate can keep working while the proprietor decides -
  // so activity and existing commitments block selection, never the application itself.
  applicationFeasibility(character, job) {
    const blockingCodes = [];
    if (job.fundingSourceType === "building" && this.requireBuilding(job.fundingSourceId).status !== "ACTIVE") blockingCodes.push("BUILDING_NOT_ACTIVE");
    if (job.creatorId === character.id) blockingCodes.push("SELF_EMPLOYMENT");
    if (character.agentAvailability === "unavailable") blockingCodes.push("AGENT_UNAVAILABLE");
    if (character.locationId !== (job.boardLocationId ?? job.locationId)) blockingCodes.push("WRONG_LOCATION");
    if (this.pendingApplications(job).some((application) => application.characterId === character.id)) blockingCodes.push("ALREADY_APPLIED");
    if (job.workerIds.includes(character.id)) blockingCodes.push("ALREADY_SELECTED");
    if (job.workerIds.length >= job.teamSize) blockingCodes.push("TEAM_FULL");
    if (this.clock.now() >= new Date(job.offerExpiresAt)) blockingCodes.push("JOB_OFFER_EXPIRED");
    else if (this.clock.now() > new Date(job.startGraceUntil)) blockingCodes.push("START_WINDOW_CLOSED");
    if (job.teamSize === 1 && Object.entries(job.requirements ?? {})
      .some(([skill, required]) => (character.skills?.[skill] ?? 0) < required)) {
      blockingCodes.push("SKILL_REQUIREMENT");
    }
    if (this.unmetReputationRequirements(character, job).length > 0) blockingCodes.push("REPUTATION_REQUIREMENT");
    const uniqueBlockingCodes = [...new Set(blockingCodes)];
    return {
      status: uniqueBlockingCodes.length === 0 ? "eligible" : "blocked",
      eligible: uniqueBlockingCodes.length === 0,
      blockingCode: uniqueBlockingCodes[0] ?? null,
      blockingCodes: uniqueBlockingCodes,
    };
  }

  applyForRole(characterId, jobId) {
    const character = this.requireCharacter(characterId);
    const job = this.requireJob(jobId);
    if (job.hiring !== "application") throw invalid("NOT_AN_APPLICATION_ROLE", "This post is taken with accept_job, not applied for");
    if (job.status !== "open") throw conflict("JOB_UNAVAILABLE", "The role is no longer open");
    const feasibility = this.applicationFeasibility(character, job);
    if (!feasibility.eligible) {
      const code = feasibility.blockingCode;
      if (code === "JOB_OFFER_EXPIRED") {
        this.expireJobOffer(job.id, job.offerExpiresAt);
        throw conflict("JOB_OFFER_EXPIRED", "The role offer has expired");
      }
      const conflicts = new Set(["SELF_EMPLOYMENT", "AGENT_UNAVAILABLE", "ALREADY_APPLIED", "ALREADY_SELECTED", "TEAM_FULL", "START_WINDOW_CLOSED"]);
      if (conflicts.has(code)) throw conflict(code, `Application refused: ${code.toLowerCase().replaceAll("_", " ")}`);
      throw invalid(code, code === "WRONG_LOCATION"
        ? "Character must be at the notice board to apply"
        : `Application refused: ${code.toLowerCase().replaceAll("_", " ")}`);
    }
    const applied = this.record("BUILDING_ROLE_APPLIED", {
      actorCharacterId: characterId,
      subjectCharacterId: job.creatorId,
      data: {
        jobId, applicationId: this.idGenerator(), characterId,
        title: job.title, boardLocationId: job.boardLocationId,
        appliedAt: this.clock.now().toISOString(),
      },
    });
    // The proprietor may be anywhere; a selection nobody is prompted for is a role that
    // quietly expires, so the application interrupts the way an invitation does.
    this.record("AGENT_NOTIFICATION_QUEUED", {
      actorCharacterId: characterId,
      subjectCharacterId: job.creatorId,
      causedByEventIds: [applied.id],
      data: {
        characterId: job.creatorId, sourceEventId: applied.id,
        level: "HIGH", urgency: "normal",
        summary: `${character.name} applied for "${job.title}". Select before ${job.offerExpiresAt}.`,
        requestKind: "event_reaction", compatibleActions: ["select_applicant", "ignore_event"],
        timingPolicyVersion: this.config.timing.policyVersion,
      },
    });
    return applied;
  }

  withdrawApplication(characterId, jobId) {
    this.requireCharacter(characterId);
    const job = this.requireJob(jobId);
    const application = this.pendingApplications(job).find((item) => item.characterId === characterId);
    if (!application) throw conflict("NO_PENDING_APPLICATION", "Character has no pending application for that role");
    return this.record("BUILDING_ROLE_APPLICATION_WITHDRAWN", {
      actorCharacterId: characterId,
      subjectCharacterId: job.creatorId,
      causedByEventIds: [application.appliedByEventId],
      data: { jobId, applicationId: application.id, characterId, title: job.title },
    });
  }

  // The candidate-side facts a selection would be revalidated against right now. Presence
  // is deliberately absent: the selected worker still has to walk there, and start_job is
  // where presence, Energy, and the window are enforced.
  selectionFeasibility(candidate, job) {
    const blockingCodes = [];
    if (job.fundingSourceType === "building" && this.requireBuilding(job.fundingSourceId).status !== "ACTIVE") blockingCodes.push("BUILDING_NOT_ACTIVE");
    if (candidate.agentAvailability === "unavailable") blockingCodes.push("AGENT_UNAVAILABLE");
    if (candidate.activity) blockingCodes.push("ACTIVITY_CONFLICT");
    if (this.activeCommitmentFor(candidate.id)) blockingCodes.push("JOB_COMMITMENT_CONFLICT");
    if (this.activeCourseEnrollmentFor(candidate.id)) blockingCodes.push("COURSE_COMMITMENT_CONFLICT");
    if (job.teamSize === 1 && Object.entries(job.requirements ?? {})
      .some(([skill, required]) => (candidate.skills?.[skill] ?? 0) < required)) {
      blockingCodes.push("SKILL_REQUIREMENT");
    }
    if (this.unmetReputationRequirements(candidate, job).length > 0) blockingCodes.push("REPUTATION_REQUIREMENT");
    return {
      status: blockingCodes.length === 0 ? "eligible" : "blocked",
      eligible: blockingCodes.length === 0,
      blockingCode: blockingCodes[0] ?? null,
      blockingCodes,
    };
  }

  // What the proprietor may know about a candidate: name, when they applied, and the public
  // track record in the domains this role names. Never their skills, goals, or wallet - the
  // server validated the qualifications, so the number the chooser needs is the one only
  // history can write. No score and no ordering: the brain does the arithmetic.
  applicationView(job, application) {
    const candidate = this.requireCharacter(application.characterId);
    const relevantDomains = [...new Set([
      ...Object.entries(job.requirements ?? {}).filter(([, level]) => level > 0).map(([skill]) => skill),
      ...Object.keys(job.reputationRequirements ?? {}),
    ])];
    const feasibility = this.selectionFeasibility(candidate, job);
    return {
      applicationId: application.id,
      candidateId: candidate.id,
      name: candidate.name,
      appliedAt: application.appliedAt,
      reputation: {
        general: candidate.reputation,
        domains: Object.fromEntries(relevantDomains.map((domain) => [domain, candidate.domainReputation?.[domain] ?? 0])),
      },
      stillEligible: feasibility.eligible,
      blockingCodes: feasibility.blockingCodes,
    };
  }

  selectApplicant(characterId, jobId, applicationId) {
    this.requireCharacter(characterId);
    const job = this.requireJob(jobId);
    if (job.hiring !== "application") throw invalid("NOT_AN_APPLICATION_ROLE", "This post is not filled by selection");
    if (job.creatorId !== characterId) throw forbidden("NOT_PROPRIETOR", "Only the publishing proprietor selects applicants");
    if (job.status !== "open") throw conflict("JOB_UNAVAILABLE", "The role is no longer open");
    if (this.clock.now() >= new Date(job.offerExpiresAt)) {
      this.expireJobOffer(job.id, job.offerExpiresAt);
      throw conflict("JOB_OFFER_EXPIRED", "The role offer has expired");
    }
    if (this.clock.now() > new Date(job.startGraceUntil)) throw conflict("START_WINDOW_CLOSED", "The disclosed start window has closed");
    const application = (job.applications ?? []).find((item) => item.id === applicationId);
    if (!application) throw new DomainError("APPLICATION_NOT_FOUND", "Application not found", 404);
    if (application.status !== "pending") throw conflict("APPLICATION_NOT_PENDING", `Application is ${application.status}`);
    const candidate = this.requireCharacter(application.characterId);
    const feasibility = this.selectionFeasibility(candidate, job);
    // A stale selection fails loudly and changes nothing: the escrow stays reserved, the
    // application row already told the proprietor why, and another candidate can be picked.
    if (!feasibility.eligible) {
      throw new DomainError("CANDIDATE_NO_LONGER_ELIGIBLE",
        `${candidate.name} can no longer take the role`, 409, { blockingCodes: feasibility.blockingCodes });
    }
    const prospectiveWorkerIds = [...job.workerIds, candidate.id];
    const teamComplete = prospectiveWorkerIds.length === job.teamSize;
    if (teamComplete && job.teamSize > 1) {
      const uncovered = this.teamRequirementGaps(job, prospectiveWorkerIds);
      if (uncovered.length > 0) {
        throw invalid("TEAM_SKILL_COVERAGE", "The completed team would not cover every requirement", { uncovered });
      }
    }
    const filled = this.record("BUILDING_ROLE_FILLED", {
      actorCharacterId: characterId,
      subjectCharacterId: candidate.id,
      causedByEventIds: [application.appliedByEventId],
      data: {
        jobId, applicationId, characterId: candidate.id, selectedById: characterId,
        title: job.title, wage: job.compensation,
        workerIds: prospectiveWorkerIds, teamComplete,
        locationId: job.locationId,
        scheduledStartAt: job.scheduledStartAt, startGraceUntil: job.startGraceUntil,
      },
    });
    // Selection creates the same commitment acceptance would, through the same events, so
    // no-shows, escrow, and conflicts need no second set of rules.
    const commitment = this.record(teamComplete ? "JOB_ACCEPTED" : "JOB_TEAM_MEMBER_JOINED", {
      actorCharacterId: candidate.id,
      subjectCharacterId: job.creatorId,
      causedByEventIds: [filled.id],
      data: teamComplete
        ? {
          jobId, workerId: candidate.id, workerIds: prospectiveWorkerIds, title: job.title,
          locationId: job.locationId, acceptedAt: this.clock.now().toISOString(),
          scheduledStartAt: job.scheduledStartAt, startGraceUntil: job.startGraceUntil,
          reservationId: job.reservation.id, applicationId,
        }
        : {
          jobId, workerId: candidate.id, workerIds: prospectiveWorkerIds, teamSize: job.teamSize,
          title: job.title, locationId: job.locationId, joinedAt: this.clock.now().toISOString(),
          applicationId,
        },
    });
    this.record("AGENT_NOTIFICATION_QUEUED", {
      actorCharacterId: characterId,
      subjectCharacterId: candidate.id,
      causedByEventIds: [filled.id],
      data: {
        characterId: candidate.id, sourceEventId: filled.id,
        level: "HIGH", urgency: "normal",
        summary: `You were selected for "${job.title}"; be at ${this.requireLocation(job.locationId).name} to start between ${job.scheduledStartAt} and ${job.startGraceUntil}.`,
        requestKind: "event_reaction", compatibleActions: ["move", "start_job", "ignore_event"],
        timingPolicyVersion: this.config.timing.policyVersion,
      },
    });
    if (teamComplete) {
      for (const other of this.pendingApplications(job)) {
        this.record("BUILDING_ROLE_CANDIDATE_REJECTED", {
          actorCharacterId: characterId,
          subjectCharacterId: other.characterId,
          causedByEventIds: [filled.id, other.appliedByEventId],
          data: {
            jobId, applicationId: other.id, characterId: other.characterId,
            title: job.title, cause: "another_candidate_selected",
          },
        });
      }
    }
    return commitment;
  }

  startJob(workerId, jobId) {
    const worker = this.requireCharacter(workerId);
    const job = this.requireJob(jobId);
    const feasibility = this.jobStartFeasibility(worker, job);
    if (!feasibility.eligible) throw new DomainError(feasibility.blockingCode, feasibility.message, feasibility.httpStatus);
    const workers = job.workerIds.map((id) => this.requireCharacter(id));
    const now = this.clock.now();
    const workEnergyCost = job.energyCost ?? this.config.energy.workCost;

    const energyEvents = workers.map((candidate) => this.changeEnergy(candidate.id, -workEnergyCost, "work"));
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

  jobStartFeasibility(worker, job) {
    const blocked = (code, message, httpStatus = 409) => ({
      status: "blocked", eligible: false, blockingCode: code, blockingCodes: [code], message, httpStatus,
    });
    if (worker.agentAvailability === "unavailable") return blocked("AGENT_UNAVAILABLE", "Unavailable agents cannot start new jobs");
    if (job.status !== "accepted" || !job.workerIds.includes(worker.id)) return blocked("JOB_NOT_ASSIGNED", "Job is not assigned to this character");
    const workers = job.workerIds.map((id) => this.requireCharacter(id));
    if (workers.some((candidate) => candidate.agentAvailability === "unavailable")) return blocked("TEAM_MEMBER_UNAVAILABLE", "A team member is unavailable");
    if (workers.some((candidate) => candidate.activity)) return blocked("ACTIVITY_CONFLICT", "A team member is busy");
    if (workers.some((candidate) => candidate.locationId !== job.locationId)) return blocked("TEAM_NOT_COLOCATED", "All team members must be at the job location", 422);
    const now = this.clock.now();
    if (now < new Date(job.scheduledStartAt) || now > new Date(job.startGraceUntil)) return blocked("OUTSIDE_JOB_WINDOW", "Job cannot start outside its disclosed start window", 422);
    if (workers.some((candidate) => candidate.energy < (job.energyCost ?? this.config.energy.workCost))) return blocked("INSUFFICIENT_ENERGY", "A team member lacks the required work Energy", 422);
    return { status: "eligible", eligible: true, blockingCode: null, blockingCodes: [] };
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
    // A building's purse is spent by its proprietor, so the proprietor is the funder for
    // cancellation - otherwise a resident-created role could never be withdrawn by anyone.
    const isFunder = (job.fundingSourceType === "character" && job.fundingSourceId === actor.id)
      || (job.fundingSourceType === "building"
        && this.state.buildings.get(job.fundingSourceId)?.proprietorId === actor.id);
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

  // A job a character has finished is not a job they are still on. The check used to match
  // any post that listed them as a worker and was not open, which a completed post still is
  // until its cooldown returns it to the board - so finishing a job locked a resident out of
  // the entire market until that same job came back. They could only ever re-do the one they
  // had just done, which is why the pilot's twenty-seven completions landed on three job ids
  // and two residents did twenty-six of them.
  activeCommitmentFor(characterId) {
    return [...this.state.jobs.values()].find((candidate) => candidate.workerIds?.includes(characterId)
      && !TERMINAL_JOB_STATUSES.has(candidate.status)
      && (candidate.status !== "open" || candidate.workerIds.length > 0));
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
    // A commitment walked away from is a verified outcome too. The no-show bills every
    // worker who accepted and failed to appear; abandonment and a pre-start cancellation
    // bill only whoever acted, because teammates did not choose it.
    if (terminalCause === "worker_no_show") {
      for (const workerId of payoutWorkerIds) this.grantWorkReputation(workerId, job, "work_no_show", terminal.id, worldTime);
    } else if (terminalCause === "worker_abandoned_after_start" && actorCharacterId) {
      this.grantWorkReputation(actorCharacterId, job, "work_abandoned", terminal.id, worldTime);
    } else if (terminalCause === "worker_cancelled_before_start" && actorCharacterId) {
      this.grantWorkReputation(actorCharacterId, job, "work_cancelled", terminal.id, worldTime);
    }
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
        expectedRecovery: this.restRecoveryFor(character),
      },
    });
    this.endActiveConversations(characterId, "incompatible_activity", rest.id);
    return rest;
  }

  createEvent({
    creatorId = null, id = this.idGenerator(), title, locationId, startsAt, endsAt,
    profile = null, accessPrice = 0, capacity = null, description = null,
    buildingId = null, accessDestinationType = null, accessDestinationId = null,
    causedByEventIds = [],
  }) {
    if (creatorId) this.requireCharacter(creatorId);
    this.requireLocation(locationId);
    requiredText(title, "event title", 120);
    if (this.state.gatherings.has(id)) throw conflict("EVENT_EXISTS", `Event ${id} already exists`);
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!(end > start)) throw invalid("INVALID_WINDOW", "Event time window is invalid");
    const price = Number(accessPrice ?? 0);
    if (!Number.isInteger(price)
      || price < this.config.experience.minimumAccessPrice
      || price > this.config.experience.maximumAccessPrice) {
      throw invalid("INVALID_ACCESS_PRICE",
        `Admission must be an integer between ${this.config.experience.minimumAccessPrice} and ${this.config.experience.maximumAccessPrice}`);
    }
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
      throw invalid("INVALID_CAPACITY", "Experience capacity must be a positive integer");
    }
    return this.record("EVENT_CREATED", {
      actorCharacterId: creatorId,
      causedByEventIds,
      data: {
        id, creatorId, title, locationId,
        startsAt: start.toISOString(), endsAt: end.toISOString(),
        // An experience without an authored profile stays a plain gathering: it has
        // no experiential value, because there is nothing to compare a preference to.
        profile: profile ? normalizeExperienceProfile(profile, this.config.grammar) : null,
        accessPrice: price,
        capacity,
        ...(description ? { description: String(description).slice(0, 500) } : {}),
        ...(buildingId ? { buildingId } : {}),
        // A resident-hosted night pays its proprietor; an operator-configured one pays
        // the system budget, so Credit supply stays auditable either way.
        accessDestinationType: accessDestinationType ?? "system_budget",
        accessDestinationId: accessDestinationId ?? this.config.economy.bootstrapBudgetId,
        profileTaxonomyVersion: this.config.grammar.profileTaxonomyVersion,
        experienceCommercePolicyVersion: this.config.experience.commercePolicyVersion,
      },
    });
  }

  // The protocol keeps the attend_event action name; joinExperience is the single
  // authoritative command behind it, as the commerce policy requires.
  attendEvent(characterId, eventId, options = {}) {
    return this.joinExperience(characterId, eventId, options);
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
      // The pair is the repetition key: meeting the same person daily proves less each
      // time, so two colluding residents cannot mint reliability off each other.
      this.applyReputationOutcome(fromId, {
        cause: "commitment_kept", role: "participant", sourceEventId: kept.id,
        repetitionKey: `commitment_kept:${fromId}:${toId}`, worldTime: at.toISOString(),
      });
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
    for (const absentId of absentIds) {
      this.applyReputationOutcome(absentId, {
        cause: "commitment_missed", role: "participant", sourceEventId: missed.id,
        repetitionKey: `commitment_missed:${commitment.id}`, worldTime,
      });
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

  startConversation(initiatorId, targetId, openingMessage = "", sharedFacts = [], options = {}) {
    // Validated up front: an invented topic must not leave a half-started conversation
    // behind, and the opening turn is only written at the end of this command.
    const openingTopics = normalizeTopics(options.topics, this.config.grammar);
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
    if (openingMessage) this.sendMessage(initiatorId, conversationId, openingMessage, sharedFacts, { opening: true, topics: openingTopics });
    return event;
  }

  sendMessage(senderId, conversationId, text, sharedFacts = [], options = {}) {
    const topics = normalizeTopics(options.topics, this.config.grammar);
    const sender = this.requireCharacter(senderId);
    const conversation = this.requireConversation(conversationId);
    const feasibility = this.conversationTurnFeasibility(sender, conversation, options);
    if (!feasibility.eligible) throw new DomainError(feasibility.blockingCode, feasibility.message, feasibility.httpStatus);
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
        // Controlled vocabulary, so what a conversation was about can weigh on the
        // listener's experience without the server ever classifying free text.
        topics,
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
    const evidence = this.eventById(evidenceEventId);
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
      multiplier = this.config.relationship.appraisalRepetitionMultipliers[prior] ?? 0;
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
    if (!Array.isArray(influencedByEventIds) || influencedByEventIds.length === 0
      || influencedByEventIds.length > this.config.protocol.maximumDecisionCauses) {
      throw invalid("MISSING_CAUSALITY", `A later decision must reference 1-${this.config.protocol.maximumDecisionCauses} permitted causal events`);
    }
    for (const eventId of influencedByEventIds) {
      const source = this.eventById(eventId);
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
    const source = this.eventById(proposal.sourceEventId);
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
    // A self-authored goal lives in its own declared words; a target would be an invented
    // mechanical handle riding a validated field.
    if (type === "pursue_goal") {
      if (targetId) throw invalid("GOAL_TARGET_NOT_ALLOWED", "A pursue_goal goal lives in declaredReason and takes no target");
      return;
    }
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
    if (notification.ackEventId) return this.eventById(notification.ackEventId);
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
    const derivedReal = typeof this.clock.realMillisecondsForGameMinutes === "function"
      ? this.clock.realMillisecondsForGameMinutes(worldMinutes)
      : worldMinutes * 60_000 / 6;
    // The floor is in wall-clock, because what it protects is the runtime's ability to
    // think, and thinking does not speed up when the world does. Both deadlines derive
    // from the same duration, so they cannot disagree.
    const referenceFactor = 24 / this.config.timing.referenceRealHoursPerGameDay;
    const realDuration = Math.max(derivedReal, worldMinutes * 60_000 / referenceFactor);
    const effectiveWorldMinutes = typeof this.clock.gameMinutesForRealMilliseconds === "function"
      ? Math.max(worldMinutes, this.clock.gameMinutesForRealMilliseconds(realDuration))
      : worldMinutes;
    this.record("AGENT_NOTIFICATION_DELIVERED", {
      actorCharacterId: characterId,
      causedByEventIds: [notificationEventId],
      data: {
        characterId,
        notificationEventId,
        deliveredAt: this.clock.now().toISOString(),
        deliveredAtReal: deliveredReal.toISOString(),
        respondByWorldTime: addGameMinutes(this.clock.now(), effectiveWorldMinutes).toISOString(),
        respondByRealTime: new Date(deliveredReal.getTime() + realDuration).toISOString(),
        requestedWorldMinutes: worldMinutes,
        effectiveWorldMinutes: Math.round(effectiveWorldMinutes * 100) / 100,
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
    const queuedEvent = this.eventById(notificationEventId);
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
      buildingId: notification.buildingId,
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

  resolveNotification(notificationEventId, status, resolutionEventId, outcome, worldTime = null) {
    const notification = this.state.notifications.get(notificationEventId);
    if (!notification || isNotificationTerminal(notification.status)) return null;
    return this.record("AGENT_NOTIFICATION_RESOLVED", {
      actorCharacterId: notification.characterId,
      causedByEventIds: [notificationEventId, resolutionEventId],
      worldTime,
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
      // A deadline that lapsed is not the same as a person who chose to say nothing.
      // In the two-hour pilot every single silence was an expired window - not one agent
      // ever chose to stay quiet - and the world charged all of them a trust penalty,
      // filling the relationship ledger with grudges nobody felt. So: an explicit silence
      // (remainSilent) keeps the full penalty; a first lapsed window costs affection and
      // adds friction but never trust; and a window lapsed by a runtime that is already
      // missing its replies costs nothing at all, because the world has already concluded
      // the brain is not answering and must not bill that twice as a personality.
      const silentCharacter = this.state.characters.get(notification.characterId);
      const runtimeAlreadyMissing = silentCharacter
        ? silentCharacter.agentAvailability === "unavailable" || silentCharacter.consecutiveMissedResponses > 0
        : false;
      if (waitingCharacterId && !runtimeAlreadyMissing) {
        this.applyRelationshipRule("response_window_missed", {
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
    // Unavailability was a one-way door: nothing cleared the flag except a fresh connection
    // test. In the pilot four runtimes were flagged in the first 23 minutes and then went on
    // to submit 131 accepted actions between them, while the world kept refusing their jobs
    // and conversations as "unavailable". An action arriving here is proof the runtime is
    // answering, whatever the action turns out to be worth, so liveness is restored before
    // any rule gets to read it.
    this.verifyAgentRecovery(characterId);
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
        const event = this.startMove(characterId, action.destinationId, { vehicleId: action.vehicleId ?? null });
        result = this.actionResult(characterId, event, {
          expectedEndAt: event.data.expectedEndAt,
          ...(event.data.vehicleId ? { vehicleId: event.data.vehicleId, vehicleUsageCost: event.data.vehicleUsageCost } : {}),
        });
        break;
      }
      case "start_conversation": {
        const event = this.startConversation(characterId, action.targetCharacterId, action.openingMessage, action.sharedFacts ?? [], { topics: action.topics });
        result = this.actionResult(characterId, event, { conversationId: event.data.conversationId });
        break;
      }
      case "send_message": {
        const event = this.sendMessage(characterId, action.conversationId, action.text, action.sharedFacts, { topics: action.topics });
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
      case "apply_for_role": {
        const event = this.applyForRole(characterId, action.jobId);
        result = this.actionResult(characterId, event, { applicationId: event.data.applicationId });
        break;
      }
      case "withdraw_application": {
        const event = this.withdrawApplication(characterId, action.jobId);
        result = this.actionResult(characterId, event);
        break;
      }
      case "select_applicant": {
        const event = this.selectApplicant(characterId, action.jobId, action.applicationId);
        result = this.actionResult(characterId, event, {
          jobId: action.jobId, selectedCandidateId: event.data.workerId,
          teamComplete: event.type === "JOB_ACCEPTED",
        });
        break;
      }
      case "enroll_course": {
        const event = this.enrollInCourse(characterId, action.courseId);
        result = this.actionResult(characterId, event, {
          courseId: action.courseId, price: event.data.price, startBy: event.data.startBy,
        });
        break;
      }
      case "start_course": {
        const event = this.startCourse(characterId, action.courseId);
        result = this.actionResult(characterId, event, { expectedEndAt: event.data.expectedEndAt });
        break;
      }
      case "abandon_course": {
        const event = this.abandonCourse(characterId, action.courseId);
        result = this.actionResult(characterId, event, {
          cause: event.data.cause, feeForfeited: event.data.feeForfeited,
        });
        break;
      }
      case "offer_course": {
        const event = this.offerResidentCourse(characterId, {
          buildingId: action.buildingId, boardLocationId: action.boardLocationId,
          catalogEntryId: action.catalogEntryId, skill: action.skill,
          tradeoffSkill: action.tradeoffSkill ?? null, price: action.price,
          title: action.title, description: action.description,
        });
        result = this.actionResult(characterId, event, { courseId: event.data.id, price: event.data.price });
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
        const event = this.attendEvent(characterId, action.eventId, {
          expectedHappiness: action.expectedHappiness ?? null,
        });
        result = this.actionResult(characterId, event, {
          expectedEndAt: event.data.expectedEndAt,
          price: event.data.price, entryEnergyCost: event.data.entryEnergyCost,
          expectedHappiness: event.data.expectedHappiness,
        });
        break;
      }
      case "stay_experience": {
        const event = this.stayExperience(characterId, action.eventId);
        result = this.actionResult(characterId, event, { nextDecisionAt: event.data.nextDecisionAt });
        break;
      }
      case "leave_experience": {
        const event = this.leaveExperience(characterId, action.eventId);
        result = this.actionResult(characterId, event, {
          eventId: action.eventId, presenceMinutes: event.data.presenceMinutes,
        });
        break;
      }
      // Authorship. These four mutate world structure rather than the character's own
      // state, which is a class of command the protocol did not previously have.
      case "construct_building": {
        const event = this.constructBuilding(characterId, action);
        result = this.actionResult(characterId, event, {
          buildingId: event.data.buildingId,
          constructionCost: event.data.constructionCost,
          capacity: event.data.capacity,
          dailyUpkeep: event.data.dailyUpkeep,
          completesAt: event.data.completesAt,
        });
        break;
      }
      case "reactivate_building": {
        const event = this.reactivateBuilding(characterId, action.buildingId);
        result = this.actionResult(characterId, event, {
          buildingId: event.data.buildingId, status: event.data.status,
          nextUpkeepAt: this.nextUpkeepAt(this.requireBuilding(event.data.buildingId)),
        });
        break;
      }
      case "enter_world": {
        const event = this.enterWorld(characterId, action.locationId);
        result = this.actionResult(characterId, event, { locationId: action.locationId });
        break;
      }
      case "buy_vehicle": {
        const event = this.buyVehicle(characterId, action.vehicleId);
        result = this.actionResult(characterId, event, {
          vehicleId: event.data.vehicleId, price: event.data.price,
        });
        break;
      }
      case "publish_role": {
        const event = this.publishRole(characterId, {
          buildingId: action.buildingId, boardLocationId: action.boardLocationId,
          title: action.title, description: action.description,
          requirements: action.requirements, durationGameMinutes: action.durationGameMinutes,
          wage: action.wage, teamSize: action.teamSize,
        });
        result = this.actionResult(characterId, event, { jobId: event.data.id });
        break;
      }
      case "host_experience": {
        const event = this.hostExperience(characterId, action);
        result = this.actionResult(characterId, event, {
          eventId: event.data.id, startsAt: event.data.startsAt, endsAt: event.data.endsAt,
          accessPrice: event.data.accessPrice, capacity: event.data.capacity,
        });
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
      if (due.kind === "construction") {
        this.completeConstruction(due.worldTime);
        continue;
      }
      if (due.kind === "building_upkeep" || due.kind === "building_abandonment") {
        this.chargeBuildingUpkeep(due.worldTime);
        continue;
      }
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
      if (due.kind === "system_job_slot_expiry") {
        this.finalizeJob(this.requireJob(due.jobId), {
          terminalStatus: "expired", terminalCause: "unfilled_system_slot",
          workerShare: 0, actorCharacterId: null, worldTime: due.worldTime,
        });
        continue;
      }
      if (due.kind === "system_job_reopen") {
        this.reopenRepeatableJobs(due.worldTime, due.jobId);
        continue;
      }
      if (due.kind === "job_no_show") {
        this.failJobForNoShow(due.jobId, due.worldTime);
        continue;
      }
      if (due.kind === "course_no_show") {
        this.expireCourseEnrollment(due.enrollmentId, due.worldTime);
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
        for (const workerId of workerIds) {
          this.changeHappiness(workerId, -this.config.happiness.completedWorkCost, "work_completed", {
            causedByEventIds: [completed.id], worldTime: activity.expectedEndAt,
          });
          // Only a completed post teaches, and only the skills it actually demanded.
          this.grantSkillGains(workerId, job, completed.id, activity.expectedEndAt);
          this.grantWorkReputation(workerId, job, "work_completed", completed.id, activity.expectedEndAt);
        }
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
        // Freeze the advertised recovery when rest starts. A server restart under a
        // newer policy must not rewrite the outcome of an activity already accepted.
        const recovered = Math.min(
          activity.expectedRecovery ?? this.config.energy.restRecovery,
          this.config.energy.maximum - character.energy,
        );
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
      } else if (activity.type === "course") {
        // Completion is the only gate to the effects, and it happens exactly once: the
        // enrolment must still be the started one, so a replayed or duplicated timer can
        // never apply a second dose.
        const enrollment = this.state.courseEnrollments.get(activity.enrollmentId);
        if (!enrollment || enrollment.status !== "started") continue;
        const course = this.state.courses.get(enrollment.courseId);
        const effects = courseEffectsFor(course, character.skills, this.config.skills);
        const completed = this.record("COURSE_COMPLETED", {
          actorCharacterId: character.id,
          causedByEventIds: [activity.startedByEventId],
          worldTime: activity.expectedEndAt,
          data: {
            enrollmentId: enrollment.id, courseId: course.id, characterId: character.id,
            title: course.title, effects,
            coursePolicyVersion: this.config.courses.policyVersion,
            courseCatalogVersion: course.courseCatalogVersion,
            skillPolicyVersion: this.config.skills.policyVersion,
            processingDelayWorldMilliseconds: Math.max(0, this.clock.now() - new Date(activity.expectedEndAt)),
          },
        });
        for (const effect of effects.filter((item) => item.delta !== 0)) {
          this.record("SKILL_CHANGED", {
            actorCharacterId: character.id,
            causedByEventIds: [completed.id],
            worldTime: activity.expectedEndAt,
            data: {
              characterId: character.id, skill: effect.skill, previous: effect.previous,
              delta: effect.delta, value: effect.value,
              ...(effect.ceiling !== undefined ? { ceiling: effect.ceiling } : {}),
              reason: "course_completed", courseId: course.id,
              skillPolicyVersion: this.config.skills.policyVersion,
            },
          });
        }
      } else if (activity.type === "attend_event") {
        // The experience ended rather than the resident leaving, but it is the same
        // single resolution point: presence Energy and Happiness settle here too.
        this.endExperienceAttendance(character.id, activity.eventId, "experience_completed", activity.expectedEndAt);
      }
    }
    this.reopenRepeatableJobs(target);
    this.applyHappinessDecay(target);
  }

  // A standing post comes back after its cooldown instead of expiring. The board never
  // empties, so a resident can work its way up to a building rather than racing the
  // clock, and a run does not quietly run out of things to do. Every terminal outcome
  // counts, not just a completion - a post nobody turned up for is still a post.
  reopenRepeatableJobs(targetWorldTime, onlyJobId = null) {
    const target = new Date(targetWorldTime);
    for (const job of [...this.state.jobs.values()]) {
      if (onlyJobId && job.id !== onlyJobId) continue;
      if (!job.repeatable || !TERMINAL_JOB_STATUSES.has(job.status) || !job.reopensAt) continue;
      if (job.fundingSourceType === "building" && this.requireBuilding(job.fundingSourceId).status !== "ACTIVE") continue;
      if (new Date(job.reopensAt) > target) continue;
      const funding = this.fundingBalance(job.fundingSourceType, job.fundingSourceId);
      // When the funder can no longer cover it the post simply stays closed. A world
      // that has spent its bootstrap budget should run out of work, not out of rules.
      if (funding < job.compensation) continue;
      const reopenedAt = new Date(job.reopensAt);
      this.record("JOB_REOPENED", {
        worldTime: job.reopensAt,
        data: {
          jobId: job.id, reservationId: this.idGenerator(), amount: job.compensation,
          currency: this.config.jobs.currency,
          fundingSourceType: job.fundingSourceType, fundingSourceId: job.fundingSourceId,
          reopenedAt: job.reopensAt,
          scheduledStartAt: job.reopensAt,
          startGraceUntil: addGameMinutes(reopenedAt, this.config.jobs.startGraceWorldHours * 60).toISOString(),
          offerExpiresAt: addGameMinutes(reopenedAt, this.config.jobs.defaultOfferDurationWorldHours * 60).toISOString(),
          escrowPolicyVersion: this.config.jobs.escrowPolicyVersion,
        },
      });
    }
  }

  // Construction is a building-scoped timer, not a character activity: a proprietor pays
  // for the work rather than doing it, so they stay free while the place goes up. On
  // completion the building becomes a real location, which is the first time anything in
  // this world has created a location at runtime.
  completeConstruction(targetWorldTime) {
    const target = new Date(targetWorldTime);
    for (const building of [...this.state.buildings.values()]) {
      if (building.status !== "UNDER_CONSTRUCTION") continue;
      if (new Date(building.completesAt) > target) continue;
      const locationId = building.buildingId;
      const started = this.record("LOCATION_DEFINED", {
        worldTime: building.completesAt,
        data: {
          id: locationId, name: building.name,
          x: building.x, y: building.y, buildingId: building.buildingId,
        },
      });
      this.record("BUILDING_ACTIVATED", {
        actorCharacterId: building.proprietorId,
        causedByEventIds: [started.id],
        worldTime: building.completesAt,
        data: {
          buildingId: building.buildingId, locationId,
          proprietorId: building.proprietorId,
          name: building.name, capacity: building.capacity,
          capabilities: [...building.capabilities],
          activatedAt: building.completesAt,
          lifecyclePolicyVersion: this.config.city.lifecyclePolicyVersion,
          lifecycleTerms: this.buildingLifecycleTerms(building),
        },
      });
    }
  }

  // Upkeep is what stops a building being a free permanent asset. It is charged straight
  // to the proprietor's wallet - the same wallet admission has been feeding - so a place
  // that draws a paying crowd pays for itself and an idle one bleeds its owner.
  chargeBuildingUpkeep(targetWorldTime) {
    const target = new Date(targetWorldTime);
    for (const building of [...this.state.buildings.values()]) {
      if (!["ACTIVE", "DELINQUENT", "INACTIVE"].includes(building.status)) continue;
      const terms = this.buildingLifecycleTerms(building);
      const intervalMs = terms.upkeepIntervalWorldMinutes * 60_000;
      const since = new Date(building.lastUpkeepAt ?? building.activatedAt);
      const elapsed = Math.floor((target - since) / intervalMs);
      if (elapsed < 1) continue;
      for (let charge = 1; charge <= elapsed; charge += 1) {
        const chargedAt = new Date(since.getTime() + charge * intervalMs).toISOString();
        const current = this.state.buildings.get(building.buildingId);
        if (!["ACTIVE", "DELINQUENT", "INACTIVE"].includes(current.status)) break;
        const amount = current.upkeepPerInterval;
        // The proprietor's own pocket pays: a resident holding a thousand credits should
        // not lose a building over an unpaid two, and delinquency is meant to mean
        // insolvent rather than inattentive.
        const proprietor = this.state.characters.get(current.proprietorId);
        const fromProprietor = Math.min(amount, proprietor?.credits ?? 0);
        const covered = fromProprietor >= amount;
        const previousStatus = current.status;
        const due = this.record("BUILDING_UPKEEP_DUE", {
          actorCharacterId: current.proprietorId, worldTime: chargedAt,
          data: {
            buildingId: current.buildingId, proprietorId: current.proprietorId, amount,
            dueAt: chargedAt, lifecyclePolicyVersion: this.config.city.lifecyclePolicyVersion,
            lifecycleTerms: terms,
          },
        });
        const outcome = this.record(covered ? "BUILDING_UPKEEP_PAID" : "BUILDING_UPKEEP_FAILED", {
          actorCharacterId: current.proprietorId,
          causedByEventIds: [due.id],
          worldTime: chargedAt,
          data: {
            buildingId: current.buildingId, proprietorId: current.proprietorId,
            amount, chargedAt, reason: "scheduled_upkeep",
            fromProprietor: covered ? fromProprietor : 0,
            ...(covered ? {} : { shortfall: amount - fromProprietor }),
            lifecyclePolicyVersion: this.config.city.lifecyclePolicyVersion,
          },
        });
        if (covered && previousStatus !== "ACTIVE") {
          this.transitionBuilding(current, "ACTIVE", outcome, chargedAt, previousStatus);
        } else if (!covered) {
          const missed = current.missedUpkeepIntervals;
          const status = missed >= terms.closedAfterMissedUpkeepIntervals ? "CLOSED"
            : missed >= terms.inactiveAfterMissedUpkeepIntervals ? "INACTIVE" : "DELINQUENT";
          if (status !== previousStatus) this.transitionBuilding(current, status, outcome, chargedAt, previousStatus);
        }
      }
    }
    for (const building of this.state.buildings.values()) {
      if (building.status !== "CLOSED") continue;
      const terms = this.buildingLifecycleTerms(building);
      const abandonedAt = new Date(new Date(building.closedAt).getTime()
        + terms.abandonedAfterClosedIntervals * terms.upkeepIntervalWorldMinutes * 60_000);
      if (abandonedAt <= target) {
        this.transitionBuilding(building, "ABANDONED", { id: building.closedByEventId }, abandonedAt.toISOString());
      }
    }
  }

  restRecoveryFor(character) {
    return Math.min(this.config.energy.restRecovery, this.config.energy.maximum - character.energy);
  }

  // The neglect pressure. A resident who only works and never gathers drifts toward
  // the floor and stays there; the floor keeps it bounded.
  applyHappinessDecay(targetWorldTime) {
    const policy = this.config.happiness;
    const target = new Date(targetWorldTime);
    for (const character of this.state.characters.values()) {
      if (character.happiness === undefined || character.happiness <= policy.decayFloor) continue;
      const resolutions = this.state.happinessResolutions.get(character.id) ?? [];
      const since = resolutions.length > 0
        ? new Date(resolutions.at(-1).worldTime)
        : new Date(character.createdAtWorldTime ?? this.history[0]?.worldTime ?? target);
      const lastDecay = character.lastHappinessDecayAt ? new Date(character.lastHappinessDecayAt) : since;
      const from = lastDecay > since ? lastDecay : since;
      const windowMs = policy.decayWindowWorldMinutes * 60_000;
      const elapsedWindows = Math.floor((target - from) / windowMs);
      if (elapsedWindows < 1) continue;
      const raw = -policy.decayPerWorldDay * elapsedWindows;
      const floorHeadroom = character.happiness - policy.decayFloor;
      const applied = Math.max(raw, -floorHeadroom);
      const at = new Date(from.getTime() + elapsedWindows * windowMs).toISOString();
      this.record("HAPPINESS_DECAYED", {
        actorCharacterId: character.id,
        worldTime: at,
        data: {
          characterId: character.id, worldDays: elapsedWindows,
          previous: character.happiness, value: character.happiness + applied,
          delta: applied, floor: policy.decayFloor,
          // Decay is the absence of experience, not an experience, so it lowers the
          // state without subtracting from the total of what was lived.
          lived: false,
          happinessPolicyVersion: policy.policyVersion,
        },
      });
    }
  }

  // Mirrors validateGoalTarget: the identifiers this character is allowed to name.
  // Kept as ids so a compact baseline can still support goals and invitations.
  knownTargetIds(characterId) {
    const character = this.requireCharacter(characterId);
    const characterIds = new Set();
    for (const key of this.state.relationships.keys()) {
      if (key.startsWith(`${characterId}->`)) characterIds.add(key.slice(key.indexOf("->") + 2));
    }
    if (character.activity?.type !== "moving") {
      for (const other of this.state.characters.values()) {
        if (other.id !== characterId && other.locationId === character.locationId && other.activity?.type !== "moving") {
          characterIds.add(other.id);
        }
      }
    }
    const now = this.clock.now();
    return {
      characterIds: [...characterIds].sort(),
      locationIds: [...this.state.locations.keys()].sort(),
      eventIds: [...this.state.gatherings.values()]
        .filter((gathering) => new Date(gathering.endsAt) >= now)
        .map((gathering) => gathering.id).sort(),
    };
  }

  // Compact summaries of every catalog resource. `since` is the contextVersion the
  // runtime last saw, so the delta needs no server-side memory of past deliveries.
  getContextSummaries(characterId, since = 0) {
    this.requireCharacter(characterId);
    return contextSummaries(this, characterId, Number(since) || 0);
  }

  // An explicit decision-scoped catalog request. Read-only: it records telemetry and
  // never reserves availability, so submission stays authoritative.
  inspectContext(characterId, options = {}) {
    const page = inspectCatalog(this, characterId, options);
    this.record("DECISION_CONTEXT_REQUESTED", {
      actorCharacterId: characterId,
      data: {
        characterId,
        resource: page.resource,
        filterKeys: page.appliedFilters,
        pageSize: page.returned,
        resultCount: page.count,
        blockedCount: page.blockedCount,
        blockedOmitted: page.blockedOmitted,
        bytes: JSON.stringify(page.items).length,
        catalogVersion: page.catalogVersion,
        contextContractVersion: CONTEXT_CONTRACT_VERSION,
      },
    });
    return page;
  }

  getObservation(characterId, { contextMode = "full", contextVersion = 0 } = {}) {
    if (!CONTEXT_MODES.includes(contextMode)) {
      throw invalid("INVALID_CONTEXT_MODE", `Context mode must be one of ${CONTEXT_MODES.join(", ")}`);
    }
    const character = this.requireCharacter(characterId);
    // A resident who has not arrived sees a different world: not a place with neighbours and
    // a board, but four squares and a choice between them. Short-circuiting here is also what
    // keeps a null location from reaching the ninety-odd rules that assume one.
    if (!character.locationId) return this.arrivalObservation(character);
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
    // A notice board is a physical thing standing in a square. You read the one you are
    // standing at; the others are somewhere you have to walk to. This is what removes
    // WRONG_LOCATION as noise - not by filtering it out of the view, but by making the
    // world work the way the view already implied. Your own work follows you, because a
    // commitment you took is not a notice you are browsing.
    const boardHere = (job) => (job.boardLocationId ?? job.locationId) === character.locationId;
    // A role you published follows you like work you took: the funder of a building role
    // is the building, so creatorId is the only handle its proprietor has on it.
    const availableJobs = [...this.state.jobs.values()]
      .filter((job) => job.workerIds.includes(characterId) || job.fundingSourceId === characterId
        || job.creatorId === characterId
        || (job.status === "open" && boardHere(job)))
      .map((job) => publicJob(job, job.energyCost ?? this.config.energy.workCost));
    // What the other squares are holding, as a count. A resident should know a market
    // exists without being shown its stock from across the city: that is the difference
    // between a reason to travel and a reason to stay.
    const jobBoards = [...this.state.locations.values()]
      .filter((location) => !location.buildingId)
      .map((location) => ({
        locationId: location.id, name: location.name,
        openJobs: [...this.state.jobs.values()].filter((job) => job.status === "open"
          && (job.boardLocationId ?? job.locationId) === location.id).length,
        // A course three squares away is a reason to travel, stated as a count: the notice
        // itself is read at its own board, same as work.
        openCourses: [...this.state.courses.values()].filter((course) => course.status === "open"
          && course.boardLocationId === location.id).length,
        travelMinutes: location.id === character.locationId
          // On foot: the one distance that is complete (no undisclosed wear inside it),
          // matches what a vehicle-less move does, and holds still while a wallet moves.
          // What a garage does to it is the rider's own arithmetic, and the exact options
          // sit on the move affordance where the choice is made.
          ? 0 : this.travelDurationBetween(character.locationId, location.id),
        here: location.id === character.locationId,
      }))
      .sort((left, right) => left.travelMinutes - right.travelMinutes);
    const upcomingEvents = [...this.state.gatherings.values()]
      .filter((event) => new Date(event.endsAt) >= this.clock.now())
      // Price, capacity, and profile must survive this projection: the attend_event
      // affordance is built from it, discloses all three, and has its feasibility
      // decided on them.
      .map((event) => ({
        id: event.id, title: event.title, locationId: event.locationId, buildingId: event.buildingId ?? null,
        startsAt: event.startsAt, endsAt: event.endsAt,
        accessPrice: event.accessPrice ?? 0,
        capacity: event.capacity ?? null,
        profile: event.profile ? structuredClone(event.profile) : null,
      }));
    const invitations = [...this.state.invitations.values()]
      .filter((invitation) => invitation.participantIds.includes(characterId))
      .map((invitation) => structuredClone(invitation));
    const commitments = [...this.state.commitments.values()]
      .filter((commitment) => commitment.participantIds.includes(characterId))
      .map((commitment) => structuredClone(commitment));

    const decision = this.getDecisionRequirement(characterId);
    const stateVersion = this.characterStateVersion(characterId);
    const progressive = contextMode === "progressive";
    // Affordances are computed from the full sets either way: progressive mode
    // changes what is shipped, never what the character is allowed to consider.
    const availableActions = this.availableActions(
      character, nearby, activeConversations, recentConversations, availableJobs, upcomingEvents,
      invitations, commitments,
    );
    return {
      worldTime: this.clock.now().toISOString(),
      rulesVersion: this.config.rules.version,
      rulesDigest: this.agentRulesDigest(characterId),
      // A stateless runtime keeps the manifest cached by version; progressive mode
      // omits the body and expects the runtime to fetch it once per version.
      ...(progressive ? {} : { rules: this.getAgentRules(characterId) }),
      contextMode,
      contextContractVersion: CONTEXT_CONTRACT_VERSION,
      contextVersion: stateVersion,
      summaries: this.getContextSummaries(characterId, contextVersion),
      // Identifiers, not records: what this character may legitimately name as the
      // target of a goal or an invitation. Compact enough for the baseline, and it
      // keeps a runtime from having to fetch a catalog just to know what exists.
      known: this.knownTargetIds(characterId),
      recentHappiness: structuredClone((this.state.happinessResolutions.get(characterId) ?? []).slice(-5)),
      goalSourceEventIds: character.secondaryGoals.filter((goal) => goal.status === "active")
        .map((goal) => goal.sourceEventId).filter((id) => {
          const source = this.eventById(id);
          return source && this.characterMayReference(characterId, source);
        }),
      stateVersion,
      character: publicCharacter(character),
      nearby,
      activeConversations,
      recentConversations,
      pendingNotifications,
      invitations,
      commitments,
      // Detail that a decision may not need becomes requestable rather than resident.
      ...(progressive ? {} : {
        relationships: knownRelationships,
        knowledge: [...(this.state.knowledge.get(characterId)?.values() ?? [])].map((item) => structuredClone(item)),
        availableJobs,
        upcomingEvents,
      }),
      // What the city is offering tonight, in both modes. Progressive disclosure made
      // this requestable, and across three runs no agent requested it once - so a
      // gathering more than one step away was effectively invisible. It is a handful of
      // compact rows and it is the difference between a city and a room.
      cityTonight: this.cityTonight(character, upcomingEvents),
      // Where the work is, without shipping the work itself.
      jobBoards,
      ...availableActions,
      decision,
      decisionRequiredAt: decision.decisionRequiredAt,
      nextScheduledDecisionAt: decision.decisionRequiredAt,
    };
  }

  // Everything a brain needs to choose where to begin, and nothing it has not earned: what
  // each square's board asks for and pays, how many people are already standing there, and
  // what is on tonight. Not who those people are - it has not met them.
  arrivalObservation(character) {
    const squares = [...this.state.locations.values()]
      .filter((location) => !location.buildingId)
      .map((location) => {
        const board = [...this.state.jobs.values()].filter((job) => job.status === "open"
          && (job.boardLocationId ?? job.locationId) === location.id);
        const pay = board.map((job) => job.compensation);
        const asks = new Set();
        for (const job of board) {
          for (const [skill, level] of Object.entries(job.requirements ?? {})) if (level > 0) asks.add(skill);
        }
        return {
          locationId: location.id, name: location.name, x: location.x, y: location.y,
          openJobs: board.length,
          openCourses: [...this.state.courses.values()].filter((course) => course.status === "open"
            && course.boardLocationId === location.id).length,
          payRange: pay.length ? { lowest: Math.min(...pay), highest: Math.max(...pay) } : null,
          boardAsksFor: [...asks].sort(),
          residentsHere: [...this.state.characters.values()]
            .filter((other) => other.locationId === location.id).length,
        };
      })
      .sort((left, right) => (left.locationId < right.locationId ? -1 : 1));
    return {
      worldTime: this.clock.now().toISOString(),
      rulesVersion: this.config.rules.version,
      rulesDigest: this.agentRulesDigest(character.id),
      contextMode: "arrival",
      contextContractVersion: CONTEXT_CONTRACT_VERSION,
      stateVersion: this.characterStateVersion(character.id),
      arriving: true,
      character: publicCharacter(character, this.config),
      squares,
      cityTonight: this.cityTonight({ ...character, locationId: squares[0]?.locationId ?? null }, []),
      availableActions: squares.map((square) => ({
        type: "enter_world", locationId: square.locationId, name: square.name,
        openJobs: square.openJobs, residentsHere: square.residentsHere,
      })),
      opportunities: [],
      cannotRightNow: [],
      decision: this.getDecisionRequirement(character.id),
      decisionRequiredAt: this.getDecisionRequirement(character.id).decisionRequiredAt,
      nextScheduledDecisionAt: this.getDecisionRequirement(character.id).decisionRequiredAt,
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
        eventAttendanceCost: this.config.experience.entryEnergyCost,
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
        systemSlots: "Unfilled system-funded slots expire after their start window, refund escrow without a worker penalty, and reopen only if repeatable, after cooldown and with sufficient budget. Resident-created roles keep their own published deadlines; this policy does not renew them.",
        individualRequirements: "Every listed skill threshold must be met by the worker.",
        teamRequirements: "For team jobs the recruited team must collectively cover every listed skill threshold; compensation is split equally.",
        applicationRoles: "A notice with hiring 'application' is a resident-created role: apply_for_role at its board and wait. The proprietor selects among applicants before the deadline; selection commits you to its schedule exactly like an accepted job. It may also require a minimum Domain Reputation.",
      },
      courses: {
        policyVersion: this.config.courses.policyVersion,
        catalogVersion: this.config.courses.catalogVersion,
        startGraceWorldHours: this.config.courses.startGraceWorldHours,
        instruction: "A course is the paid way INTO a skill no reachable work teaches. Its notice discloses provider, price, duration, Energy, prerequisites and the exact effects for you before you pay; effects apply exactly once, at completion, up to the course's ceiling.",
        tuition: "Tuition is paid in full at enrolment and never refunded: cancelling, abandoning, or missing the disclosed start window forfeits it and applies no effect. Energy is charged when the class starts.",
        oneCommitment: "One commitment at a time: an open enrolment blocks accepting work and an accepted job blocks enrolling.",
        providing: "A building with sell_service may offer courses from the approved catalog, choosing only the skill, a price inside the entry's band, and a public square for the notice. Tuition is paid to you, the proprietor, like admission.",
      },
      vehicles: {
        policyVersion: this.config.vehicles.policyVersion,
        catalog: this.config.vehicles.catalog.map((vehicle) => ({
          vehicleId: vehicle.id, price: vehicle.price,
          travelTimeFactor: vehicle.travelTimeFactor, usageCost: vehicle.usageCost,
        })),
        instruction: "Vehicles are sold by the city only, into your garage: you may own one of each. Every move is on foot unless you name a vehicleId on the action; each move's travelOptions state the minutes and the usageCost of every way you could travel, and the wear is charged in credits whenever you ride. Boards and cityTonight state on-foot distances; what your garage does to them is your own arithmetic. Which trip deserves which vehicle is your call.",
      },
      reputation: {
        policyVersion: this.config.reputation.policyVersion,
        domains: [...this.config.skills.set],
        range: [this.config.reputation.minimum, this.config.reputation.maximum],
        visibility: "General and per-domain values are public; the causes behind your own are visible only to you.",
        instruction: "Reputation is a track record written only by verified outcomes: completed work builds it in the skills the post demanded, no-shows and abandonment spend it faster than work earns it, kept and missed meeting commitments move the general value, and a hosted night that resolved well credits its organizer. You cannot assert it, and repeating the same evidence pays less and then nothing.",
        consequence: "Proprietors read reputation when selecting applicants, and a role may set a minimum Domain Reputation.",
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
        selfAuthored: "pursue_goal is self-authored memory: no target, nothing completes it automatically. Submit declaredReason; it returns as guidance in every observation. Abandon it when done or let it expire. Never duplicate an active goal of the same type and target.",
      },
      consequences: {
        instruction: "Accepted actions can change energy, credits, work state, commitments, and directional relationships. Kept and broken commitments affect trust.",
      },
      happiness: {
        policyVersion: this.config.happiness.policyVersion,
        range: [this.config.happiness.minimum, this.config.happiness.maximum],
        profileDimensions: [...this.config.grammar.profileDimensions],
        instruction: "Happiness is what your lived experiences are worth. It is separate from Credits, which say what you can afford, and Energy, which says what you can sustain. You cannot set it; the world resolves it from what actually happened.",
        experienceValue: "An experience resolves once, when you leave or when it ends. Its value comes from how well its profile matches your own preferences, who was actually there and how you feel about them, how much of it you were present for, whether you actually talked to anyone, the size of the crowd, and how recently you did something similar.",
        pursuit: "Attending costs Credits and Energy and pays Happiness, so it is worth choosing deliberately. Going somewhere that matches nothing you care about, leaving after a minute, or repeating the same kind of gathering makes it worse, not neutral.",
        // No debuff: the approved policy deliberately has none, because a run is won on
        // the lived total, so neglect already costs you the thing you are playing for.
        // Charging it twice would be double-charging the same choice.
        neglect: `Going ${this.config.happiness.decayWindowWorldMinutes / 1440} world day(s) without a resolved experience costs ${this.config.happiness.decayPerWorldDay} Happiness, down to a floor of ${this.config.happiness.decayFloor}, and every completed job costs ${this.config.happiness.completedWorkCost} more. Nothing punishes low Happiness directly. The cost is simply that you end with Credits and almost nothing lived, and the lived total is part of what a run is won on.`,
        livedTotal: "Happiness is two numbers. 'happiness' is how good your life is right now: bounded, and it saturates as it approaches either end. 'livedHappiness' is the unbounded total of everything you have actually lived, and together with Credits and relationships it is what a run is won on. A wonderful evening when you are already happy barely moves the first and counts in full toward the second, so there is never a point at which experiences stop being worth having.",
        expectedHappiness: `When joining, you may include expectedHappiness: your own integer prediction of the raw result from ${-this.config.happiness.maximumChangePerExperience} to ${this.config.happiness.maximumChangePerExperience}. It is optional, immutable after entry, never affects resolution or rewards, and is shown beside the realized result only to measure your prediction.`,
        privacy: "You see your own Happiness and preferences and never another character's.",
        decisions: `On entry and at checkpoints you may talk, leave, or stay_experience to wait up to ${this.config.experience.decisionIntervalWorldMinutes} world minutes. Relevant notifications can wake you earlier. Staying changes no reward formula and does not end attendance. recentHappiness contains only your own last five raw predictions, outcomes and factors; use it to learn, not as a guaranteed reward.`,
      },
      city: {
        gridVersion: this.config.city.gridVersion,
        grammarPolicyVersion: this.config.city.grammarPolicyVersion,
        lifecyclePolicyVersion: this.config.city.lifecyclePolicyVersion,
        grid: [this.config.city.width, this.config.city.height],
        capabilities: [...this.config.city.capabilities],
        instruction: "The city is a grid and you may build on it. There is no land to buy: construct_building on any free cell claims the ground and raises the place in one action. You name it, describe it, and choose what it delivers using the same profile dimensions your own preferences use. The world never decides what kind of place it is.",
        cost: `Construction costs cells x (${this.config.city.structuralCostPerCell} + ${this.config.city.profileCostPerCell} x ambition^${this.config.city.ambitionExponent}), where ambition is the sum of your ten profile values divided by 100. The cost rises with the square of the total you promise, so a place that delivers everything is unaffordable and a focused one is cheap. Deciding what your place is for is the whole choice.`,
        ceiling: "A building's profile is the ceiling on every experience you can host there. A venue with music 40 can never host the city's great music night; paying for music 90 is how you earn the right to.",
        earning: "Admission to an experience you host is paid straight to you, the proprietor. Upkeep is charged to your wallet too, so an unused building bleeds you and a busy one pays for itself.",
        lifecycle: `Upkeep is due every ${this.config.city.upkeepIntervalWorldMinutes} world minutes. One failed payment makes a building DELINQUENT; ${this.config.city.inactiveAfterMissedUpkeepIntervals} consecutive failures make it INACTIVE and ${this.config.city.closedAfterMissedUpkeepIntervals} make it CLOSED. Before closure, reactivate_building pays one interval now and restarts the schedule, or a funded scheduled payment recovers it automatically. Missed charges remain in history but create no debt. Closed buildings become ABANDONED after ${this.config.city.abandonedAfterClosedIntervals} more intervals. Closed and abandoned buildings cannot recover in version 1. New operations and admissions stop outside ACTIVE; already accepted work, enrolled courses, attendance and commitments still settle normally.`,
        capacityRule: `Capacity is ${this.config.city.capacityPerCell} per cell of footprint, so a bigger footprint holds more people and costs proportionally more to build.`,
      },
      // The context discipline is a stable rule, so it lives in the manifest rather
      // than in each runtime's private prompt. A stateless model that receives only
      // this manifest and a baseline must be able to work out that the baseline is
      // deliberately incomplete and that asking for detail is its job.
      context: {
        contractVersion: CONTEXT_CONTRACT_VERSION,
        requestable: [...CONTEXT_RESOURCES],
        instruction: "The observation carries only what your current decision requires. Detailed catalogs are not included. Request one with the summary's requestAction when, and only when, your decision needs it.",
        summaryReading: "A summary count includes items you cannot currently act on; feasibleCount says how many are possible. A low feasibleCount is not an empty world: request the catalog and read the blockers, because the blocker is often the real decision.",
        caching: "This manifest is stable for its version. Cache it by rulesVersion and stop re-requesting it. Feasibility, energy, credits, capacity, and availability are never stable and always come from the current observation.",
        authority: "A requested catalog reserves nothing. Submission is revalidated, so a disclosed item can still be rejected.",
      },
    };
  }

  // The manifest is currently identical for every character, so its digest is
  // computed once per rules version and reused. Runtimes compare it to validate a
  // cached manifest without downloading the body again.
  agentRulesDigest(characterId) {
    if (this.cachedRulesDigest?.version !== this.config.rules.version) {
      this.cachedRulesDigest = {
        version: this.config.rules.version,
        digest: createHash("sha256").update(JSON.stringify(this.getAgentRules(characterId))).digest("hex").slice(0, 16),
      };
    }
    return this.cachedRulesDigest.digest;
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
    if (character.activity?.type === "attend_event") {
      const inConversation = [...this.state.conversations.values()].some((conversation) =>
        conversation.status === "active" && conversation.participantIds.includes(characterId));
      const at = character.activity.nextDecisionAt ?? character.activity.startedAt;
      return {
        requiredNow: !inConversation && this.clock.now() >= new Date(at),
        decisionRequiredAt: inConversation ? null : at,
        reason: inConversation ? "waiting_for_event" : "experience_checkpoint", notificationEventId: null,
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

  getOwnerFeed(options) {
    return ownerProjection.getOwnerFeed(this, options);
  }

  ownerFeedItem(event, characterId) {
    return ownerProjection.ownerFeedItem(this, event, characterId);
  }

  createReturnSummary(options) {
    return ownerProjection.createReturnSummary(this, options);
  }

  viewReturnSummary(ownerId, characterId, summaryId) {
    return ownerProjection.viewReturnSummary(this, ownerId, characterId, summaryId);
  }

  viewStoryDetail(ownerId, characterId, eventId) {
    return ownerProjection.viewStoryDetail(this, ownerId, characterId, eventId);
  }

  rateStory(ownerId, characterId, eventId, rating) {
    return ownerProjection.rateStory(this, ownerId, characterId, eventId, rating);
  }

  getProductMetrics(options) {
    return ownerProjection.getProductMetrics(this, options);
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
    const jobs = [...this.state.jobs.values()].map((job) => publicJob(job, job.energyCost ?? this.config.energy.workCost));
    // The operator sees every course and how its enrolments went, next to the jobs it
    // competes with for the same day.
    const courses = [...this.state.courses.values()].map((course) => {
      const enrollments = [...this.state.courseEnrollments.values()]
        .filter((enrollment) => enrollment.courseId === course.id);
      return {
        ...structuredClone(course),
        enrollmentCount: enrollments.length,
        completedCount: enrollments.filter((enrollment) => enrollment.status === "completed").length,
        abandonedCount: enrollments.filter((enrollment) => enrollment.status === "abandoned").length,
      };
    });
    // AIT-1006. The operator sees the grid, who holds what, and how each building is
    // doing, without seeing any character's private reasoning.
    const city = {
      gridVersion: this.config.city.gridVersion,
      width: this.config.city.width,
      height: this.config.city.height,
      cheapestUsefulBuilding: this.buildingQuote({ music: 100 }, 1, 1).constructionCost,
      capabilities: [...this.config.city.capabilities],
      upkeepIntervalWorldMinutes: this.config.city.upkeepIntervalWorldMinutes,
      profileTaxonomyVersion: this.config.grammar.profileTaxonomyVersion,
      plots: [...this.state.plots.values()].map((plot) => ({
        id: plot.id, x: plot.x, y: plot.y, ownerId: plot.ownerId, buildingId: plot.buildingId,
      })),
      buildings: [...this.state.buildings.values()].map((building) => ({
        buildingId: building.buildingId, name: building.name, description: building.description ?? null,
        proprietorId: building.proprietorId, locationId: building.locationId,
        x: building.x, y: building.y, width: building.width, height: building.height,
        status: building.status, capacity: building.capacity,
        capabilities: [...building.capabilities], profile: structuredClone(building.profile),
        tags: derivedTags(building.profile, this.config.grammar),
        constructionCost: building.constructionCost, dailyUpkeep: building.dailyUpkeep,
        upkeepPerInterval: building.upkeepPerInterval,
        // The venue keeps a revenue/upkeep ledger, not a purse: takings land in the
        // proprietor's wallet, so there is no separate balance to report.
        revenue: building.revenue, upkeepPaid: building.upkeepPaid,
        ...this.buildingLifecycleView(building),
        completesAt: building.completesAt ?? null,
        // Whether the doors are actually open, so the observer can see an idle venue for
        // what it is rather than inferring it from who happens to be standing inside.
        ...(building.locationId ? (({ open, opensAt, title }) => ({
          open, opensAt, nextEventTitle: title,
        }))(this.buildingDoorState(building.locationId)) : { open: false, opensAt: null, nextEventTitle: null }),
      })),
      seededLocations: [...this.state.locations.values()]
        .filter((location) => !location.buildingId)
        .map((location) => ({ id: location.id, name: location.name, x: location.x ?? null, y: location.y ?? null })),
    };
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
        energyCost: this.config.experience.entryEnergyCost,
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
    // Money sits in three places now: residents' wallets, escrow held out of the budget,
    // and the system budget itself. Venue takings used to be a fourth pot, but a venue's
    // purse is its proprietor's wallet now, so there is nothing separate to count.
    const issuedToCharacters = [...this.state.characters.values()]
      .reduce((total, character) => total + Number(character.wallet?.opening ?? 0), 0);
    // What the city has actually put into the world, net of what came back unspent. For an
    // unlimited treasury this is the only figure with meaning: a remaining balance is not a
    // fact about anything.
    const cityInjected = [...this.state.systemBudgets.values()]
      .reduce((total, budget) => total + Number(budget.drawn ?? 0) - Number(budget.returned ?? 0), 0);
    const cityUnlimited = [...this.state.systemBudgets.values()].some((budget) => budget.unlimited);
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
        issuedToCharacters,
        cityInjected,
        cityUnlimited,
        creditsRetired: this.state.creditsRetired,
        // What is still out there: everything ever issued, less what construction and upkeep
        // took out of circulation for good.
        moneySupply: issuedToCharacters + cityInjected - this.state.creditsRetired,
      },
      characters,
      locations,
      connections: [...this.state.connections.values()].map((connection) => structuredClone(connection)),
      jobs,
      courses,
      events,
      invitations: [...this.state.invitations.values()].map((invitation) => structuredClone(invitation)),
      commitments: [...this.state.commitments.values()].map((commitment) => structuredClone(commitment)),
      rules: {
        version: this.config.rules.version,
        realHoursPerGameDay: this.config.clock.realHoursPerGameDay,
        unavailableAfterMissedResponses: this.config.timing.unavailableAfterMissedResponses,
        // The observer renders every domain a resident could prove, zeros included, so the
        // taxonomy has to reach it rather than be guessed from whichever skills happen to
        // have values.
        reputationDomains: [...this.config.skills.set],
        maximumEnergy: this.config.energy.maximum,
        movementEnergyCost: this.config.energy.movementCost,
        workEnergyCost: this.config.energy.workCost,
        eventAttendanceEnergyCost: this.config.experience.entryEnergyCost,
        // Hosting is priced on what the night promises: base + rate x (sum of profile / 100).
        hostingBaseEnergyCost: this.config.experience.hostingBaseEnergyCost,
        hostingEnergyPerAmbition: this.config.experience.hostingEnergyPerAmbition,
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
      city,
      // The whole tuning surface, verbatim: finding the balance is a matter of playing
      // with parameters, and an operator cannot play with numbers it cannot see.
      parameters: structuredClone(this.config),
      // Every action an agent can submit, with its parameters - the catalog a test pins
      // against the real dispatch, so the observer can never describe a world that is not
      // the one running.
      agentActions: structuredClone(AGENT_ACTIONS),
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
    if (relationship && relationshipStrength(relationship) >= this.config.relevance.strongRelationshipStrength) factors.strongRelationship = weights.strongRelationship;
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

  // Returns three things, because one list was doing two jobs. `availableActions` is the
  // menu: everything in it can be ordered right now, and the prompt's "pick exactly ONE"
  // points only here. `opportunities` is the map: everything that exists but is not yet
  // possible, with every field it had before - pay, duration, skills, windows - because
  // planning lives in what is not yet possible and stripping it would blind the agent.
  // `cannotRightNow` is the bridge: when one cause explains a whole class, it is said once
  // instead of being buried in a copy per item.
  //
  // The old shape handed Nia twenty-two entries under a key called "available", of which
  // fourteen were traps, and every one of the fourteen was blocked by the same thing. She
  // had to open twenty-two nested feasibility blocks to find the eight that were real, and
  // she got it wrong. The world already knows which is which; making the model re-derive it
  // every turn was work we were charging it for and then paying for again in mistakes.
  availableActions(character, nearby, conversations, recentConversations, jobs, upcomingEvents, invitations = [], commitments = []) {
    const actions = [];
    if (!character.activity) {
      const locations = this.reachableLocations(character.locationId);
      for (const location of locations) {
        if (location.id === character.locationId) continue;
        const doors = this.buildingDoorState(location.id);
        // The same rule the command applies: staff and enrolled students walk in through a
        // shut door, and an affordance that said otherwise would strand exactly the people
        // the venue is waiting for.
        const shut = doors.isVenue && !doors.open && !this.mayEnterClosedVenue(character.id, location.id, doors);
        const travelOptions = this.travelOptionsBetween(character, character.locationId, location.id);
        actions.push({
          type: "move", destinationId: location.id, name: location.name,
          energyCost: this.config.energy.movementCost,
          // On foot unless the action names a vehicleId; every way this traveller could
          // make the trip is priced here, minutes and wear both, so the choice between
          // credits and time is made on stated numbers.
          durationGameMinutes: travelOptions[0].minutes,
          ...(travelOptions.length > 1 ? { travelOptions } : {}),
          // A shut venue stays on the list with its next opening, because knowing when a
          // place opens is exactly what a resident needs in order to plan to be there.
          ...(doors.isVenue ? { opensAt: doors.opensAt, nextEventId: doors.eventId, nextEventTitle: doors.title } : {}),
          feasibility: shut
            ? { status: "blocked", eligible: false, blockingCode: "BUILDING_CLOSED", blockingCodes: ["BUILDING_CLOSED"] }
            : { status: "ready", eligible: true, blockingCode: null, blockingCodes: [] },
        });
      }
      for (const job of jobs.filter((item) => item.status === "accepted" && item.workerIds.includes(character.id))) {
        actions.push({ type: "start_job", jobId: job.id, energyCost: job.energyCost ?? this.config.energy.workCost,
          feasibility: this.jobStartFeasibility(character, job) });
        actions.push({ type: "cancel_job", jobId: job.id });
      }
      if (character.energy < this.config.energy.maximum) {
        actions.push({
          type: "rest", durationGameMinutes: this.config.energy.restDurationGameMinutes,
          expectedRecovery: this.restRecoveryFor(character),
        });
      }
      // Authorship affordances are declared, not enumerated: an agent that has decided
      // to build already knows which cell it wants, and enumerating 400 cells by four
      // footprints would cost the product of two domains for no information. What it
      // cannot guess is which cells are gone, so those are listed - there are only ever
      // a handful, and guessing them produced twelve rejections in one run.
      const city = this.config.city;
      const takenCells = [
        ...[...this.state.plots.values()]
          .filter((plot) => plot.buildingId || (plot.ownerId && plot.ownerId !== character.id))
          .map((plot) => ({ x: plot.x, y: plot.y, why: plot.buildingId ? "built on" : "legacy ownership" })),
        ...[...this.state.locations.values()]
          .filter((location) => Number.isInteger(location.x))
          .map((location) => ({ x: location.x, y: location.y, why: "occupied" })),
      ].sort((left, right) => left.x - right.x || left.y - right.y);
      {
        actions.push({
          type: "construct_building",
          gridWidth: city.width, gridHeight: city.height,
          takenCells,
          cheapestUsefulBuilding: this.buildingQuote({ music: 100 }, 1, 1).constructionCost,
          maximumFootprint: { width: city.maximumFootprintWidth, height: city.maximumFootprintHeight },
          capabilities: [...city.capabilities],
          profileDimensions: [...this.config.grammar.profileDimensions],
          capacityPerCell: city.capacityPerCell,
          // Everything needed to work out the exact price before submitting, so the cost
          // is never a surprise: cells x (structural + profile x ambition^exponent).
          costFormula: {
            structuralCostPerCell: city.structuralCostPerCell,
            profileCostPerCell: city.profileCostPerCell,
            ambitionExponent: city.ambitionExponent,
            note: "ambition is the sum of your ten profile values divided by 100",
          },
          constructionMinutesPerCell: city.constructionMinutesPerCell,
          upkeepDailyRate: city.upkeepDailyRate,
          credits: character.credits,
        });
      }
      {
        // The city's vehicle counter: the whole catalog with every term - price, factor,
        // wear - because a power-up chosen blind is a refusal waiting to happen. Sold by
        // the city only. The garage holds one of each; a full garage closes the counter.
        const owned = new Set((character.garage ?? []).map((vehicle) => vehicle.id));
        const buyable = this.config.vehicles.catalog
          .filter((vehicle) => !owned.has(vehicle.id));
        if (buyable.length > 0) {
          actions.push({
            type: "buy_vehicle",
            garage: structuredClone(character.garage ?? []),
            catalog: buyable.map((vehicle) => ({
              vehicleId: vehicle.id, price: vehicle.price,
              travelTimeFactor: vehicle.travelTimeFactor, usageCost: vehicle.usageCost,
            })),
            credits: character.credits,
            feasibility: buyable.some((vehicle) => vehicle.price <= character.credits)
              ? { status: "eligible", eligible: true, blockingCode: null, blockingCodes: [] }
              : { status: "blocked", eligible: false, blockingCode: "INSUFFICIENT_CREDITS", blockingCodes: ["INSUFFICIENT_CREDITS"] },
          });
        }
      }
      const myBuildings = [...this.state.buildings.values()]
        .filter((building) => building.proprietorId === character.id);
      for (const building of myBuildings.filter((item) => item.status === "ACTIVE")) {
        if (building.capabilities.includes("host_event")) {
          actions.push({
            type: "host_experience", buildingId: building.buildingId, name: building.name,
            locationId: building.locationId,
            profileCeiling: structuredClone(building.profile),
            maximumCapacity: building.capacity,
            canChargeAdmission: building.capabilities.includes("sell_access"),
            maximumAccessPrice: this.config.experience.maximumAccessPrice,
            revenue: building.revenue, upkeepPerInterval: building.upkeepPerInterval,
            nextUpkeepAt: this.nextUpkeepAt(building),
            liveExperienceCount: this.liveExperienceCount(building),
            // Hosting costs Energy on the ambition of what is promised, so the affordance
            // states the floor, the rate, and what this building's own profile would cost.
            hostingBaseEnergyCost: this.config.experience.hostingBaseEnergyCost,
            hostingEnergyPerAmbition: this.config.experience.hostingEnergyPerAmbition,
            hostingEnergyCostAtCeiling: hostingEnergyCost(building.profile, this.config.experience),
            energy: character.energy,
            // One night at a time: if the room is booked, say until when, so the host picks
            // the next free slot instead of learning the rule by being refused.
            bookedUntil: this.buildingBookedUntil(building.buildingId),
          });
        }
      }
      for (const building of myBuildings.filter((item) => item.status === "ACTIVE"
        && item.capabilities.includes("create_job"))) {
        // Employ out of your own wallet, advertised on a public square. The affordance
        // names the purse and the boards, because a proprietor cannot guess either and
        // being refused is a poor way to learn them.
        actions.push({
          type: "publish_role", buildingId: building.buildingId, name: building.name,
          fundedFrom: "proprietor_wallet", availableCredits: character.credits,
          boardChoices: [...this.state.locations.values()]
            .filter((location) => !location.buildingId)
            .map((location) => ({ locationId: location.id, name: location.name })),
          workHappensAt: building.locationId,
          skillSet: [...this.config.skills.set],
        });
      }
      for (const building of myBuildings.filter((item) => item.status === "ACTIVE"
        && item.capabilities.includes("sell_service"))) {
        // Teach in your own building: the second way a place earns, after admission. The
        // affordance carries the whole approved catalog with its bands, because the terms
        // a provider may choose are exactly the terms it must be able to read.
        const openCoursesHere = [...this.state.courses.values()].filter((course) =>
          course.buildingId === building.buildingId && course.status === "open").length;
        actions.push({
          type: "offer_course", buildingId: building.buildingId, name: building.name,
          tuitionFundsProprietor: true,
          courseCatalog: this.config.courses.catalog.map((entry) => ({
            catalogEntryId: entry.id, gain: entry.gain, teachesTo: entry.teachesTo,
            prerequisite: entry.prerequisite, tradeoffLoss: entry.tradeoffLoss,
            durationGameMinutes: entry.durationGameMinutes, energyCost: entry.energyCost,
            priceMinimum: entry.priceMinimum, priceMaximum: entry.priceMaximum,
          })),
          skillSet: [...this.config.skills.set],
          boardChoices: [...this.state.locations.values()]
            .filter((location) => !location.buildingId)
            .map((location) => ({ locationId: location.id, name: location.name })),
          taughtAt: building.locationId,
          openCoursesHere: openCoursesHere,
          maximumOpenCourses: this.config.courses.maximumOpenCoursesPerBuilding,
          feasibility: openCoursesHere < this.config.courses.maximumOpenCoursesPerBuilding
            ? { status: "eligible", eligible: true, blockingCode: null, blockingCodes: [] }
            : { status: "blocked", eligible: false, blockingCode: "COURSE_LIMIT_REACHED", blockingCodes: ["COURSE_LIMIT_REACHED"] },
        });
      }
      for (const gathering of upcomingEvents) {
        if (gathering.locationId === character.locationId && new Date(gathering.startsAt) <= this.clock.now()) {
          // Everything the resident needs to weigh the evening before entering:
          // the price, both Energy costs, and what the gathering actually offers.
          actions.push({
            type: "attend_event", eventId: gathering.id, title: gathering.title,
            accessPrice: gathering.accessPrice ?? 0,
            entryEnergyCost: this.config.experience.entryEnergyCost,
            marginalEnergyPerWorldMinutes: this.config.experience.marginalEnergyPerWorldMinutes,
            marginalEnergyMaximum: this.config.experience.marginalEnergyMaximum,
            expectedHappinessRange: [
              -this.config.happiness.maximumChangePerExperience,
              this.config.happiness.maximumChangePerExperience,
            ],
            profile: gathering.profile ? structuredClone(gathering.profile) : null,
            capacity: gathering.capacity ?? null,
            attendeeCount: this.currentAttendeeCount(gathering.id),
            endsAt: gathering.endsAt,
            // Repetition is the only factor in the realized outcome that comes from private
            // history rather than from something visible, and it was computed but never
            // shipped. One resident paid to attend the same night three times for -5.3,
            // -11.0 and -11.4 happiness, each worse than the last, and nothing before the
            // third payment said the second had already cost her. The server still computes
            // no expected value: it states the factor and the brain does the arithmetic.
            repetition: this.repetitionOutlook(character.id, gathering),
            feasibility: this.eventAttendanceFeasibility(character, gathering),
          });
        }
      }
    }
    for (const building of this.state.buildings.values()) {
      if (building.proprietorId !== character.id || !["DELINQUENT", "INACTIVE"].includes(building.status)) continue;
      actions.push({
        type: "reactivate_building", buildingId: building.buildingId, name: building.name,
        ...this.buildingLifecycleView(building), availableCredits: character.credits,
        feasibility: this.buildingRecoveryFeasibility(character, building),
      });
    }
    for (const job of jobs.filter((item) => item.status === "open")) {
      // A published opportunity is a notice on a public board: a character considering
      // work reads the whole notice, not half of it. Splitting one notice between the
      // affordance and the catalog produced agents that accepted work without knowing
      // its pay or duration, so the full view stays here in both context modes.
      const view = this.jobOpportunityView(character, job);
      // The action on the notice depends on how it is filled: a city post is taken, a
      // resident-created role is applied for and the proprietor chooses.
      actions.push({ type: view.hiring === "application" ? "apply_for_role" : "accept_job", ...view });
      if (view.myApplication?.status === "pending") {
        actions.push({ type: "withdraw_application", jobId: view.jobId, title: view.title });
      }
    }
    // The proprietor's half of a hire: every pending application, with the candidate's
    // verified public track record beside it. No ordering and no score - choosing is the
    // one thing the server must not do for the brain.
    for (const job of [...this.state.jobs.values()].filter((item) =>
      item.hiring === "application" && item.status === "open" && item.creatorId === character.id)) {
      const applications = this.pendingApplications(job).map((application) => this.applicationView(job, application));
      if (applications.length === 0) continue;
      // When every applicant has gone stale the menu must not offer a choice that can only
      // be refused; the rows still say who applied and what blocks each of them.
      const anyEligible = applications.some((application) => application.stillEligible);
      actions.push({
        type: "select_applicant", jobId: job.id, title: job.title,
        wage: job.compensation, requirements: structuredClone(job.requirements ?? {}),
        reputationRequirements: structuredClone(job.reputationRequirements ?? {}),
        scheduledStartAt: job.scheduledStartAt, startGraceUntil: job.startGraceUntil,
        offerExpiresAt: job.offerExpiresAt,
        openTeamSlots: Math.max(0, job.teamSize - job.workerIds.length),
        applications,
        feasibility: anyEligible
          ? { status: "eligible", eligible: true, blockingCode: null, blockingCodes: [] }
          : { status: "blocked", eligible: false, blockingCode: "NO_ELIGIBLE_APPLICANTS", blockingCodes: ["NO_ELIGIBLE_APPLICANTS"] },
      });
    }
    // AIT-1205: the courses pinned to this board, each carrying its whole notice - terms,
    // prerequisites, and the exact effects for THIS reader - because a price discovered by
    // being refused is a price we taught the agent to guess.
    for (const course of [...this.state.courses.values()].filter((item) =>
      item.status === "open" && item.boardLocationId === character.locationId)) {
      actions.push({ type: "enroll_course", ...this.courseView(character, course) });
    }
    const enrollment = this.activeCourseEnrollmentFor(character.id);
    if (enrollment) {
      const course = this.state.courses.get(enrollment.courseId);
      if (enrollment.status === "enrolled") {
        actions.push({
          type: "start_course", courseId: course.id, title: course.title,
          locationId: course.locationId, startBy: enrollment.startBy,
          energyCost: course.energyCost, durationGameMinutes: course.durationGameMinutes,
          feasibility: this.courseStartFeasibility(character, course, enrollment),
        });
      }
      actions.push({
        type: "abandon_course", courseId: course.id, title: course.title,
        feeForfeited: enrollment.price,
      });
    }
    for (const job of jobs.filter((item) => ["open", "accepted"].includes(item.status)
      && ((item.fundingSourceType === "character" && item.fundingSourceId === character.id)
        || (item.fundingSourceType === "building"
          && this.state.buildings.get(item.fundingSourceId)?.proprietorId === character.id)))) {
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
      const turnFeasibility = this.conversationTurnFeasibility(character, this.requireConversation(conversation.id));
      actions.push({
        type: "send_message", conversationId: conversation.id,
        allowedTopics: [...this.config.grammar.profileDimensions],
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
      // An invitation is aimed: the agent has already decided who and where. It used
      // to be offered as one entry per known person per destination, which cost the
      // product of two domains, proposed inviting someone to the room the character
      // was already standing in, and carried no per-combination feasibility to
      // justify itself. Every identifier it spelled out is in `nearby`, the known
      // relationships, the reachable destinations, or the known experiences already.
      // So the affordance states the envelope and the agent supplies both parameters.
      actions.push({
        type: "send_invitation",
        openInvitationsRemaining: this.config.invitations.maximumOpenPerCharacter - openSentInvitations,
        destinationTypes: ["location", "event"],
        locationLeadWorldMinutes: this.config.invitations.locationLeadWorldMinutes,
        locationWindowWorldMinutes: this.config.invitations.locationWindowWorldMinutes,
        targetsFrom: "a co-present resident or a person you already know",
        destinationsFrom: "a location you know or a known experience",
      });
    }
    // Leaving is a real choice: attendance duration is what the participation factor
    // measures, so staying or going changes the outcome.
    if (character.activity?.type === "attend_event") {
      const attending = this.state.gatherings.get(character.activity.eventId);
      actions.push({ type: "stay_experience", eventId: character.activity.eventId,
        nextCheckInWorldMinutes: this.config.experience.decisionIntervalWorldMinutes });
      actions.push({
        type: "leave_experience", eventId: character.activity.eventId,
        startedAt: character.activity.startedAt,
        scheduledEndAt: character.activity.expectedEndAt,
        plannedEndAt: attending?.endsAt ?? character.activity.expectedEndAt,
      });
    }
    if (character.secondaryGoals.filter((goal) => goal.status === "active").length < this.config.goals.maximumActiveSecondaryGoals) {
      actions.push({ type: "propose_secondary_goal", allowedGoalTypes: [...this.config.goals.secondaryTypes] });
    }
    for (const goal of character.secondaryGoals.filter((item) => item.status === "active")) {
      actions.push({ type: "abandon_secondary_goal", goalId: goal.id });
    }
    return this.splitByFeasibility(actions);
  }

  // Blocked entries leave the menu and become the map, keeping every field. A cause shared
  // by every entry of a class is lifted out and stated once; what stays on each entry is
  // only what is specific to it, which is the part worth reading.
  splitByFeasibility(actions) {
    // Not every feasibility carries the plural form: conversation availability reports a
    // single blockingCode and no array. Reading only the array dropped the reason silently,
    // which is the one failure mode this whole split exists to prevent.
    const codesOf = (feasibility) => feasibility.blockingCodes
      ?? (feasibility.blockingCode ? [feasibility.blockingCode] : []);
    const availableActions = [];
    const blocked = [];
    for (const action of actions) {
      if (action.feasibility?.eligible === false) blocked.push(action);
      else {
        const { feasibility, ...orderable } = action;
        availableActions.push(orderable);
      }
    }
    const cannotRightNow = [];
    const sharedByType = new Map();
    for (const type of new Set(blocked.map((action) => action.type))) {
      const group = blocked.filter((action) => action.type === type);
      // A cause counts as shared only when there is something to share it with, it blocks
      // every one of them, and nothing of that type is possible at all. Lifting a cause out
      // of a class of one is not lifting, it is just moving it somewhere less obvious.
      if (group.length < 2) continue;
      if (availableActions.some((action) => action.type === type)) continue;
      const shared = group
        .map((action) => new Set(codesOf(action.feasibility)))
        .reduce((carried, codes) => new Set([...carried].filter((code) => codes.has(code))));
      if (shared.size === 0) continue;
      sharedByType.set(type, shared);
      for (const code of shared) cannotRightNow.push({ action: type, code, affects: group.length });
    }
    const opportunities = blocked.map((action) => {
      const { feasibility, ...rest } = action;
      const shared = sharedByType.get(action.type) ?? new Set();
      return {
        ...rest,
        blockedBy: codesOf(feasibility).filter((code) => !shared.has(code)),
      };
    });
    return { availableActions, opportunities, cannotRightNow };
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

  // One description of an open opportunity for one character, used both by the
  // accept_job affordance and by the requested opportunity catalog, so the two can
  // never disagree about requirements, costs, or blockers.
  jobOpportunityView(character, job) {
    // The observation hands this a projection and the catalog hands it the record; the
    // application ledger lives only on the record, so resolve it once here.
    job = this.state.jobs.get(job.id) ?? job;
    // What this post would teach, stated on the notice. Without it "you need business 35"
    // is a wall; with it, it is two completions of the business work already on this board.
    const skillGains = skillGainsFor(job.requirements, character.skills, this.config.skills);
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
    const hiring = job.hiring ?? "direct_accept";
    const myApplication = (job.applications ?? []).find((application) =>
      application.characterId === character.id
      && ["pending", "selected"].includes(application.status)) ?? null;
    return {
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
      // AIT-1603: how this notice is answered, and where this reader stands with it. The
      // same notice tells a candidate what track record it demands and how many rivals
      // have already applied - facts, not a forecast of the proprietor's choice.
      hiring,
      reputationRequirements: structuredClone(job.reputationRequirements ?? {}),
      unmetReputationRequirements: this.unmetReputationRequirements(character, job),
      applicationCount: this.pendingApplications(job).length,
      ...(myApplication ? { myApplication: { applicationId: myApplication.id, status: myApplication.status } } : {}),
      scheduledStartAt: job.scheduledStartAt,
      startGraceUntil: job.startGraceUntil,
      offerExpiresAt: job.offerExpiresAt,
      skillGains,
      feasibility: hiring === "application"
        ? this.applicationFeasibility(character, job)
        : this.jobAcceptanceFeasibility(
          character, job,
          job.teamSize > 1 && job.workerIds.length + 1 < job.teamSize ? [] : unmetRequirements,
        ),
    };
  }

  // Every condition joinExperience enforces is decided here, so the affordance, the
  // catalog, and the command cannot disagree about whether an evening is possible.
  // An agent that reads an eligible experience can act on it.
  eventAttendanceFeasibility(character, gathering) {
    const now = this.clock.now();
    const blockingCodes = [];
    if (gathering.buildingId && this.requireBuilding(gathering.buildingId).status !== "ACTIVE") blockingCodes.push("BUILDING_NOT_ACTIVE");
    if (character.activity) blockingCodes.push("ACTIVITY_CONFLICT");
    if (character.locationId !== gathering.locationId) blockingCodes.push("WRONG_LOCATION");
    if (now < new Date(gathering.startsAt)) blockingCodes.push("EVENT_NOT_STARTED");
    if (now >= new Date(gathering.endsAt)) blockingCodes.push("EVENT_ENDED");
    if (character.energy < this.config.experience.entryEnergyCost) blockingCodes.push("INSUFFICIENT_ENERGY");
    // Capacity counts who is present now, not everyone who ever entered, because that
    // is what admission is actually gated on.
    const capacity = gathering.capacity ?? null;
    if (capacity !== null && this.currentAttendeeCount(gathering.id) >= capacity) {
      blockingCodes.push("EXPERIENCE_FULL");
    }
    const price = gathering.accessPrice ?? 0;
    if (price > 0 && character.credits < price) blockingCodes.push("INSUFFICIENT_CREDITS");
    const uniqueBlockingCodes = [...new Set(blockingCodes)];
    return {
      status: uniqueBlockingCodes.length === 0 ? "eligible" : "blocked",
      eligible: uniqueBlockingCodes.length === 0,
      blockingCode: uniqueBlockingCodes[0] ?? null,
      blockingCodes: uniqueBlockingCodes,
    };
  }

  jobAcceptanceFeasibility(character, job, unmetRequirements) {
    const blockingCodes = [];
    if (job.fundingSourceType === "building" && this.requireBuilding(job.fundingSourceId).status !== "ACTIVE") blockingCodes.push("BUILDING_NOT_ACTIVE");
    if (job.creatorId === character.id) blockingCodes.push("SELF_EMPLOYMENT");
    if (character.agentAvailability === "unavailable") blockingCodes.push("AGENT_UNAVAILABLE");
    if (character.activity) blockingCodes.push("ACTIVITY_CONFLICT");
    // Acceptance is gated on the board, not the site: the affordance and the command have to
    // agree about which place matters, or one of them is lying.
    if (character.locationId !== (job.boardLocationId ?? job.locationId)) blockingCodes.push("WRONG_LOCATION");
    if (job.workerIds.includes(character.id)) blockingCodes.push("ALREADY_JOINED_TEAM");
    if (job.workerIds.length >= job.teamSize) blockingCodes.push("TEAM_FULL");
    if (this.activeCommitmentFor(character.id)) blockingCodes.push("JOB_COMMITMENT_CONFLICT");
    if (this.activeCourseEnrollmentFor(character.id)) blockingCodes.push("COURSE_COMMITMENT_CONFLICT");
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

  conversationTurnFeasibility(sender, conversation, { opening = false } = {}) {
    const blocked = (code, message, httpStatus = 409) => ({
      status: "blocked", eligible: false, blockingCode: code, blockingCodes: [code], message, httpStatus,
    });
    if (!conversation.participantIds.includes(sender.id)) return blocked("NOT_PARTICIPANT", "Character is not a conversation participant", 403);
    const response = this.findConversationNotification(sender.id, conversation.id, true);
    if (response?.[1].status === "expired") return blocked("REACTION_WINDOW_EXPIRED", "The conversation response window has expired");
    if (conversation.status !== "active") return blocked("CONVERSATION_ENDED", "Conversation is no longer active");
    if (!opening && conversation.expectedResponderId && conversation.expectedResponderId !== sender.id) return blocked("OUT_OF_TURN", "Another participant is expected to respond");
    if (conversation.messages.length >= this.config.conversation.maximumTurns) return blocked("CONVERSATION_TURN_LIMIT", "Conversation turn limit reached");
    const oneMinuteAgo = addGameMinutes(this.clock.now(), -1);
    if (conversation.messages.filter((message) => new Date(message.sentAt) > oneMinuteAgo).length >= this.config.conversation.maximumTurnsPerWorldMinute) return blocked("CONVERSATION_RATE_LIMITED", "Conversation turn frequency limit reached", 429);
    if (sender.energy < this.conversationTurnEnergyCost(conversation.messages.length)) return blocked("INSUFFICIENT_ENERGY", "Insufficient Energy for this turn", 422);
    return { status: "eligible", eligible: true, blockingCode: null, blockingCodes: [] };
  }

  hasConversationAppraisal(characterId, conversationId) {
    return this.state.conversationAppraisals.has(conversationAppraisalKey(characterId, conversationId));
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

  // Every way THIS traveller can make this trip, priced in one place so the affordance,
  // the boards, and the move command cannot disagree. Walking always comes first; each
  // vehicle in the garage follows with its floored minutes and the wear its ride would
  // charge. The choice is the rider's, per trip: the server states options, never picks.
  travelOptionsBetween(character, fromLocationId, toLocationId) {
    const walkMinutes = this.travelDurationBetween(fromLocationId, toLocationId);
    if (walkMinutes === null) return null;
    const options = [{ vehicleId: null, minutes: walkMinutes, usageCost: 0, affordable: true }];
    for (const vehicle of character.garage ?? []) {
      options.push({
        vehicleId: vehicle.id,
        minutes: Math.max(this.config.movement.minimumDurationGameMinutes,
          Math.round(walkMinutes * vehicle.travelTimeFactor)),
        usageCost: vehicle.usageCost,
        affordable: character.credits >= vehicle.usageCost,
      });
    }
    return options;
  }

  // Vehicles are sold by the city, always and only: a power-up from a versioned catalog,
  // never a market residents can enter. The garage holds one of each at most; owning a
  // bicycle and a car is the point, because which one a trip deserves is a decision.
  buyVehicle(characterId, vehicleId) {
    const character = this.requireCharacter(characterId);
    const vehicle = this.config.vehicles.catalog.find((entry) => entry.id === vehicleId);
    if (!vehicle) throw invalid("UNKNOWN_VEHICLE", `${vehicleId} is not in the version-${this.config.vehicles.policyVersion} vehicle catalog`);
    if ((character.garage ?? []).some((owned) => owned.id === vehicleId)) {
      throw conflict("VEHICLE_ALREADY_OWNED", `Character already owns a ${vehicleId}`);
    }
    if (character.credits < vehicle.price) throw invalid("INSUFFICIENT_CREDITS", `A ${vehicleId} costs ${vehicle.price} credits`);
    return this.record("VEHICLE_PURCHASED", {
      actorCharacterId: characterId,
      data: {
        characterId, vehicleId, price: vehicle.price,
        travelTimeFactor: vehicle.travelTimeFactor, usageCost: vehicle.usageCost,
        vehiclePolicyVersion: this.config.vehicles.policyVersion,
      },
    });
  }

  // Travel duration, resolved in one place so the affordance, the catalog and the move
  // command cannot disagree. An explicit connection wins where one exists; otherwise the
  // grid decides, which is what makes a building on any cell reachable without an edge.
  travelDurationBetween(fromLocationId, toLocationId) {
    const connection = this.state.connections.get(`${fromLocationId}->${toLocationId}`);
    if (connection) return connection.durationGameMinutes;
    const from = this.state.locations.get(fromLocationId);
    const to = this.state.locations.get(toLocationId);
    const distance = gridDistance(from, to);
    if (distance !== null) {
      return Math.max(this.config.movement.minimumDurationGameMinutes,
        distance * this.config.movement.minutesPerCell);
    }
    // A world with no connections and no coordinates is the pre-grid seeded world.
    if (this.state.connections.size === 0) return this.config.movement.durationGameMinutes;
    return null;
  }

  // One row per public experience: enough to decide whether to go, and to know what
  // getting there costs. Affinity is arithmetic over vectors the character already
  // holds, so withholding it would only make every runtime recompute it.
  cityTonight(character, upcomingEvents) {
    const grammar = this.config.grammar;
    return upcomingEvents
      .map((gathering) => {
        const travelMinutes = gathering.locationId === character.locationId
          ? 0
          // On foot, for the same reasons jobBoards states it on foot.
          : this.travelDurationBetween(character.locationId, gathering.locationId);
        const building = gathering.buildingId ? this.state.buildings.get(gathering.buildingId) : null;
        return {
          repetition: this.repetitionOutlook(character.id, gathering),
          eventId: gathering.id,
          title: gathering.title,
          locationId: gathering.locationId,
          startsAt: gathering.startsAt,
          endsAt: gathering.endsAt,
          accessPrice: gathering.accessPrice ?? 0,
          capacity: gathering.capacity ?? null,
          attendeeCount: this.currentAttendeeCount(gathering.id),
          tags: derivedTags(gathering.profile, grammar),
          affinity: gathering.profile
            ? Math.round(profileAffinity(character.preferences, gathering.profile, grammar))
            : null,
          travelMinutes,
          here: travelMinutes === 0,
          hostedBy: building ? building.proprietorId : null,
        };
      })
      .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt)
        || (left.eventId < right.eventId ? -1 : 1));
  }

  nextUpkeepAt(building) {
    if (["CLOSED", "ABANDONED"].includes(building.status)) return null;
    const since = building.lastUpkeepAt ?? building.activatedAt;
    if (!since) return null;
    return new Date(new Date(since).getTime()
      + this.buildingLifecycleTerms(building).upkeepIntervalWorldMinutes * 60_000).toISOString();
  }

  buildingLifecycleTerms(building = null) {
    return structuredClone(building?.lifecycleTerms ?? {
      upkeepIntervalWorldMinutes: this.config.city.upkeepIntervalWorldMinutes,
      inactiveAfterMissedUpkeepIntervals: this.config.city.inactiveAfterMissedUpkeepIntervals,
      closedAfterMissedUpkeepIntervals: this.config.city.closedAfterMissedUpkeepIntervals,
      abandonedAfterClosedIntervals: this.config.city.abandonedAfterClosedIntervals,
    });
  }

  buildingLifecycleView(building) {
    const recoverable = ["DELINQUENT", "INACTIVE"].includes(building.status);
    return {
      lifecyclePolicyVersion: building.lifecyclePolicyVersion ?? this.config.city.lifecyclePolicyVersion,
      ...this.buildingLifecycleTerms(building),
      nextUpkeepAt: this.nextUpkeepAt(building),
      missedUpkeepIntervals: building.missedUpkeepIntervals ?? 0,
      lifetimeUpkeepFailures: building.lifetimeUpkeepFailures ?? 0,
      lifecycleChangedAt: building.lifecycleChangedAt ?? building.activatedAt ?? null,
      recoverable, recoveryCost: recoverable ? building.upkeepPerInterval : null,
      closedAt: building.closedAt ?? null, abandonedAt: building.abandonedAt ?? null,
    };
  }

  // Whether the place has anything on. An idle building is the thing upkeep punishes, so
  // its proprietor should be able to see that it is idle without counting events.
  liveExperienceCount(building) {
    const now = this.clock.now();
    return [...this.state.gatherings.values()].filter((gathering) =>
      gathering.buildingId === building.buildingId && new Date(gathering.endsAt) >= now).length;
  }

  // The end of the last experience already programmed here, or null when the diary is clear.
  buildingBookedUntil(buildingId) {
    const now = this.clock.now();
    const ends = [...this.state.gatherings.values()]
      .filter((gathering) => gathering.buildingId === buildingId && new Date(gathering.endsAt) > now)
      .map((gathering) => new Date(gathering.endsAt));
    return ends.length > 0 ? new Date(Math.max(...ends)).toISOString() : null;
  }

  // Work that stretches you teaches you. Applied once, on completion, bounded by the policy
  // ceiling, and never declared by the client: a skill five points short used to be five
  // points short for the life of the world.
  grantSkillGains(workerId, job, causedByEventId, worldTime) {
    const worker = this.requireCharacter(workerId);
    for (const { skill, gain, ceiling } of skillGainsFor(job.requirements, worker.skills, this.config.skills)) {
      const previous = worker.skills?.[skill] ?? 0;
      this.record("SKILL_CHANGED", {
        actorCharacterId: workerId,
        causedByEventIds: [causedByEventId],
        worldTime,
        data: {
          characterId: workerId, skill, previous, delta: gain, value: previous + gain,
          ceiling, reason: "work_completed", jobId: job.id,
          skillPolicyVersion: this.config.skills.policyVersion,
        },
      });
    }
  }

  // ---- AIT-1202. Reputation: a track record written only by verified outcomes ---------
  //
  // Every reputation movement in the world passes through here, from an authoritative
  // source event, with the cause's weights taken from policy. No command lets a brain
  // assert one: the absence of any such action is the enforcement.
  //
  // Gains saturate toward the cap - the hundredth completion proves less than the first -
  // while losses land in full and stop at the floor, because a track record that cannot be
  // dented at the top is a rank, not a record. Repetition of the same evidence key inside
  // the window pays full, then half, then nothing: the pilot's twenty-seven completions
  // landed on three standing job ids, and without this the busiest post is a pump.
  applyReputationOutcome(characterId, { cause, role, domains = [], sourceEventId, repetitionKey, worldTime = null }) {
    const character = this.requireCharacter(characterId);
    const policy = this.config.reputation;
    const weights = policy.weights[cause];
    if (!weights) throw invalid("UNKNOWN_REPUTATION_CAUSE", `${cause} is not a version-${policy.policyVersion} reputation cause`);
    const at = new Date(worldTime ?? this.clock.now());
    const since = new Date(at.getTime() - policy.repetitionWindowWorldDays * 24 * 60 * 60_000);
    const priorOutcomes = this.history.filter((event) => event.type === "REPUTATION_CHANGED"
      && event.data.characterId === characterId
      && event.data.repetitionKey === repetitionKey
      && new Date(event.worldTime) >= since).length;
    const multiplier = policy.repetitionMultipliers[priorOutcomes] ?? 0;
    const changes = [];
    const apply = (domain, raw) => {
      if (!raw) return;
      const previous = domain ? (character.domainReputation?.[domain] ?? 0) : character.reputation;
      // Anti-farming discounts gains only: a repeated failure keeps costing in full.
      const scaled = raw > 0
        ? round2(raw * multiplier * (policy.maximum - previous) / policy.maximum)
        : raw;
      const value = round2(clamp(previous + scaled, policy.minimum, policy.maximum));
      if (value === previous) return;
      changes.push(this.record(domain ? "DOMAIN_REPUTATION_CHANGED" : "REPUTATION_CHANGED", {
        actorCharacterId: characterId,
        causedByEventIds: [sourceEventId],
        worldTime: at.toISOString(),
        data: {
          characterId, domain: domain ?? null, cause, attributionRole: role,
          sourceEventId, previous, delta: round2(value - previous), value,
          repetitionKey,
          repetitionTreatment: raw < 0 || priorOutcomes === 0 ? "full" : multiplier > 0 ? "halved" : "exhausted",
          repetitionWindowWorldDays: policy.repetitionWindowWorldDays,
          reputationPolicyVersion: policy.policyVersion,
          domainTaxonomyVersion: policy.domainTaxonomyVersion,
        },
      }));
    };
    apply(null, weights.general ?? 0);
    for (const domain of domains) apply(domain, weights.domain ?? 0);
    return changes;
  }

  // Work outcomes attribute to the worker in exactly the domains the post demanded: the
  // errand that asks nothing proves only general reliability, and a technical-65 inspection
  // proves technical. Demand is the attribution rule, so a brain cannot relabel its work.
  grantWorkReputation(workerId, job, cause, sourceEventId, worldTime) {
    this.applyReputationOutcome(workerId, {
      cause,
      role: "worker",
      domains: Object.entries(job.requirements ?? {})
        .filter(([skill, required]) => required > 0 && this.config.skills.set.includes(skill))
        .map(([skill]) => skill),
      sourceEventId,
      repetitionKey: `${cause}:${job.id}`,
      worldTime,
    });
  }

  locationAtCell(x, y) {
    return [...this.state.locations.values()].find((location) => location.x === x && location.y === y) ?? null;
  }

  reachableLocations(fromLocationId) {
    return [...this.state.locations.values()]
      .filter((location) => location.id !== fromLocationId
        && this.travelDurationBetween(fromLocationId, location.id) !== null);
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
      if (job.fundingSourceType === "system_budget") {
        const slotExpiry = new Date(new Date(job.startGraceUntil).getTime() + 1);
        if (job.status === "open" && slotExpiry <= target && slotExpiry < new Date(job.offerExpiresAt)) {
          return [{ kind: "system_job_slot_expiry", jobId: job.id, worldTime: slotExpiry.toISOString() }];
        }
        if (job.repeatable && TERMINAL_JOB_STATUSES.has(job.status) && job.reopensAt
          && new Date(job.reopensAt) <= target
          && this.fundingBalance(job.fundingSourceType, job.fundingSourceId) >= job.compensation) {
          return [{ kind: "system_job_reopen", jobId: job.id, worldTime: job.reopensAt }];
        }
      }
      if (job.status === "open" && new Date(job.offerExpiresAt) <= target) {
        return [{ kind: "job_offer_expiry", jobId: job.id, worldTime: job.offerExpiresAt }];
      }
      if (job.status === "accepted" && new Date(job.startGraceUntil) <= target) {
        return [{ kind: "job_no_show", jobId: job.id, worldTime: job.startGraceUntil }];
      }
      return [];
    });
    const enrollments = [...this.state.courseEnrollments.values()].flatMap((enrollment) => {
      if (this.state.platformIncident) return [];
      if (enrollment.status === "enrolled" && new Date(enrollment.startBy) <= target) {
        return [{ kind: "course_no_show", enrollmentId: enrollment.id, worldTime: enrollment.startBy }];
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
    const buildings = [...this.state.buildings.values()].flatMap((building) => {
      if (building.status === "UNDER_CONSTRUCTION") {
        return new Date(building.completesAt) <= target
          ? [{ kind: "construction", worldTime: building.completesAt }] : [];
      }
      if (["ACTIVE", "DELINQUENT", "INACTIVE"].includes(building.status)) {
        const worldTime = this.nextUpkeepAt(building);
        return worldTime && new Date(worldTime) <= target ? [{ kind: "building_upkeep", worldTime }] : [];
      }
      if (building.status === "CLOSED") {
        const terms = this.buildingLifecycleTerms(building);
        const worldTime = new Date(new Date(building.closedAt).getTime()
          + terms.abandonedAfterClosedIntervals * terms.upkeepIntervalWorldMinutes * 60_000).toISOString();
        return new Date(worldTime) <= target ? [{ kind: "building_abandonment", worldTime }] : [];
      }
      return [];
    });
    // At an identical instant, already promised work/attendance/commitments settles
    // before upkeep. Across instants, a later wage cannot fund an earlier missed bill.
    return [...activities, ...notifications, ...goals, ...jobs, ...enrollments, ...commitments, ...buildings]
      .sort((a, b) => a.worldTime.localeCompare(b.worldTime))[0] ?? null;
  }

  changeEnergy(characterId, delta, reason, { causedByEventIds = [], worldTime = null, allowFloor = false } = {}) {
    const character = this.requireCharacter(characterId);
    const value = clamp(character.energy + delta, 0, this.config.energy.maximum);
    const floored = allowFloor && character.energy + delta < 0;
    return this.record("ENERGY_CHANGED", {
      actorCharacterId: characterId,
      causedByEventIds,
      worldTime,
      // A presence that already happened cannot be un-lived, so its marginal charge
      // takes the resident to zero rather than being refused. Recorded, not silent.
      data: { characterId, previous: character.energy, delta: value - character.energy, value, reason, ...(floored ? { floored: true } : {}) },
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
    // A public gathering and a public course notice are perceivable by everyone.
    if (event.type === "EVENT_CREATED" || event.type === "COURSE_OFFERED") return true;
    return false;
  }

  // Causal lookups resolve an event by id. Holds references into history, not copies.
  eventById(eventId) {
    return this.state.eventsById.get(eventId) ?? null;
  }

  // Read indexes maintained on every applied event, so they survive replay and
  // restart for free. Without them causal lookups and characterStateVersion
  // rescan the whole history on every observation and every action.
  indexEvent(event) {
    this.state.eventsById.set(event.id, event);
    for (const itemId of itemsTouchedByEvent(event)) {
      if (event.sequence > (this.state.itemVersions.get(itemId) ?? 0)) {
        this.state.itemVersions.set(itemId, event.sequence);
      }
    }
    if (event.type === "RELATIONSHIP_APPRAISAL_RECORDED" && event.data?.conversationId) {
      this.state.conversationAppraisals.add(
        conversationAppraisalKey(event.actorCharacterId, event.data.conversationId),
      );
    }
    if (nonProjectionEventTypes.has(event.type)) return;
    if (event.type === "EVENT_CREATED" || event.type === "COURSE_OFFERED") {
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
    this.indexEvent(event);
    applyEvent(this.state, event);
  }
}

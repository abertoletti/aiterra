// The event reducer: the single place where an applied event changes world state.
// It receives state rather than the World instance, so folding an event can never
// reach a command, the clock, or the store, and a replay is exactly this function
// run over the history in order.
import { coPresenceKey, experienceAttendanceKey, relationshipKey, round2 } from "./world-support.js";

export function applyEvent(state, event) {
  const data = event.data;
  switch (event.type) {
    case "LOCATION_DEFINED":
      state.locations.set(data.id, structuredClone(data));
      break;
    case "WORLD_CONFIGURATION_ACTIVATED":
      state.activeWorldConfigurationVersion = data.version;
      break;
    case "LOCATION_CONNECTION_DEFINED":
      state.connections.set(`${data.fromLocationId}->${data.toLocationId}`, structuredClone(data));
      break;
    case "CHARACTER_CREATED":
      state.characters.set(data.id, {
        ...structuredClone(data), activity: null, reputation: 0, score: 0,
        agentAvailability: "available", consecutiveMissedResponses: 0,
        secondaryGoals: [],
      });
      state.knowledge.set(data.id, new Map());
      break;
    case "AGENT_CREDENTIAL_CREATED":
      state.agentCredentials.set(data.credentialId, {
        credentialId: data.credentialId, characterId: data.characterId,
        permissions: [...data.permissions], tokenHash: data.tokenHash,
        createdAt: data.createdAt, revokedAt: null,
      });
      break;
    case "AGENT_CREDENTIAL_REVOKED":
      state.agentCredentials.get(data.credentialId).revokedAt = data.revokedAt;
      break;
    case "AGENT_EVENT_CHANNEL_REGISTERED":
      state.agentEventChannels.set(data.channelId, {
        id: data.channelId, characterId: data.characterId, transport: data.transport,
        verificationTokenHash: data.verificationTokenHash, status: data.status,
        registeredAt: data.registeredAt, registeredByEventId: event.id,
      });
      break;
    case "AGENT_EVENT_CHANNEL_VERIFIED": {
      const channel = state.agentEventChannels.get(data.channelId);
      channel.status = "verified";
      channel.verifiedAt = data.verifiedAt;
      break;
    }
    case "AGENT_EVENT_CHANNEL_DISABLED": {
      const channel = state.agentEventChannels.get(data.channelId);
      channel.status = "disabled";
      channel.disabledAt = data.disabledAt;
      channel.disabledReason = data.reason;
      break;
    }
    case "ENERGY_CHANGED":
      state.characters.get(data.characterId).energy = data.value;
      break;
    case "MOVEMENT_STARTED":
      state.characters.get(data.characterId).activity = {
        type: "moving", destinationId: data.destinationId, startedAt: data.startedAt,
        expectedEndAt: data.expectedEndAt, startedByEventId: event.id,
      };
      break;
    case "CHARACTER_ARRIVED": {
      const character = state.characters.get(data.characterId);
      character.locationId = data.locationId;
      character.activity = null;
      break;
    }
    case "CO_PRESENCE_STARTED":
      state.coPresence.set(coPresenceKey(data.participantIds[0], data.participantIds[1], data.locationId), {
        id: data.episodeId, participantIds: [...data.participantIds], locationId: data.locationId,
        startedAt: data.startedAt, interactionEligible: data.interactionEligible,
        startedByEventId: event.id,
      });
      break;
    case "CO_PRESENCE_ENDED":
      state.coPresence.delete(coPresenceKey(data.participantIds[0], data.participantIds[1], data.locationId));
      break;
    case "RELATIONSHIP_CREATED":
      state.relationships.set(relationshipKey(data.fromId, data.toId), {
        affinity: data.affinity, trust: data.trust, tension: data.tension,
        createdAt: event.worldTime, relationshipRuleVersion: data.relationshipRuleVersion,
      });
      break;
    case "RELATIONSHIP_CHANGED": {
      const key = relationshipKey(data.fromId, data.toId);
      if (data.dimension) {
        const relationship = state.relationships.get(key) ?? {
          affinity: 0, trust: 0, tension: 0, createdAt: event.worldTime,
          relationshipRuleVersion: data.relationshipRuleVersion,
        };
        relationship[data.dimension] = data.value;
        relationship.relationshipRuleVersion = data.relationshipRuleVersion;
        state.relationships.set(key, relationship);
      } else {
        // Replay compatibility for the prototype's former scalar edge.
        state.relationships.set(key, {
          affinity: data.value, trust: 0, tension: 0,
          createdAt: event.worldTime, relationshipRuleVersion: 1,
        });
      }
      break;
    }
    case "ECONOMY_BOOTSTRAPPED":
      state.systemBudgets.set(data.budgetId, {
        id: data.budgetId, initialCredits: data.credits, balance: data.credits,
        currency: data.currency, createdAt: event.worldTime,
      });
      break;
    case "JOB_CREATED": { 
      const fundingSourceType = data.fundingSourceType ?? "character";
      const fundingSourceId = data.fundingSourceId ?? data.creatorId;
      if (fundingSourceType === "system_budget") state.systemBudgets.get(fundingSourceId).balance -= data.compensation;
      else state.characters.get(fundingSourceId).credits -= data.compensation;
      const reservation = data.reservation ?? {
        id: `legacy-${data.id}`, amount: data.compensation, currency: "credits",
        originalFundingSource: { type: fundingSourceType, id: fundingSourceId },
        createdAt: event.worldTime, expiresAt: data.availableUntil,
        policyVersion: 1, state: "reserved",
      };
      state.jobs.set(data.id, {
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
      const job = state.jobs.get(data.jobId);
      job.workerIds = [...data.workerIds];
      job.workerId = data.workerIds[0] ?? null;
      break;
    }
    case "JOB_TEAM_MEMBER_LEFT": {
      const job = state.jobs.get(data.jobId);
      job.workerIds = [...data.workerIds];
      job.workerId = data.workerIds[0] ?? null;
      break;
    }
    case "JOB_ACCEPTED": {
      const job = state.jobs.get(data.jobId);
      job.status = "accepted";
      job.workerIds = [...(data.workerIds ?? [data.workerId])];
      job.workerId = job.workerIds[0] ?? data.workerId;
      job.acceptedAt = data.acceptedAt ?? event.worldTime;
      break;
    }
    case "JOB_STARTED": {
      const job = state.jobs.get(data.jobId);
      job.status = "running";
      job.workerIds = [...(data.workerIds ?? [data.workerId])];
      for (const workerId of job.workerIds) {
        const character = state.characters.get(workerId);
        character.activity = {
          type: "work", jobId: data.jobId, title: data.title, locationId: data.locationId,
          startedAt: data.startedAt, expectedEndAt: data.expectedEndAt, startedByEventId: event.id,
          compatibleSecondaryActions: ["start_conversation", "send_message", "end_conversation", "appraise_interaction"],
        };
      }
      break;
    }
    case "JOB_REOPENED": {
      const job = state.jobs.get(data.jobId);
      if (data.fundingSourceType === "system_budget") {
        state.systemBudgets.get(data.fundingSourceId).balance -= data.amount;
      } else {
        state.characters.get(data.fundingSourceId).credits -= data.amount;
      }
      job.status = "open";
      job.workerId = null;
      job.workerIds = [];
      job.reopensAt = null;
      job.completedAt = null;
      job.escrow = data.amount;
      job.scheduledStartAt = data.scheduledStartAt;
      job.startGraceUntil = data.startGraceUntil;
      job.offerExpiresAt = data.offerExpiresAt;
      job.availableUntil = data.offerExpiresAt;
      job.reservation = {
        id: data.reservationId, amount: data.amount, currency: data.currency,
        originalFundingSource: { type: data.fundingSourceType, id: data.fundingSourceId },
        createdAt: data.reopenedAt, expiresAt: data.offerExpiresAt,
        policyVersion: data.escrowPolicyVersion, state: "reserved",
      };
      job.timesCompleted = job.timesCompleted ?? 0;
      break;
    }
    case "JOB_COMPLETED": {
      const job = state.jobs.get(data.jobId);
      job.status = "completed";
      job.timesCompleted = (job.timesCompleted ?? 0) + 1;
      if (job.repeatable) {
        job.completedAt = event.worldTime;
        job.reopensAt = new Date(new Date(event.worldTime).getTime()
          + (job.cooldownGameMinutes ?? 0) * 60_000).toISOString();
      }
      job.escrow = 0;
      job.reservation.state = "settled";
      job.terminalCause = "valid_completion";
      job.completedAt = event.worldTime;
      const workerIds = data.workerIds ?? [data.workerId];
      const payouts = data.payouts ?? workerIds.map((workerId) => ({ workerId, amount: data.compensation / workerIds.length }));
      for (const payout of payouts) state.characters.get(payout.workerId).credits += payout.amount;
      for (const workerId of workerIds) state.characters.get(workerId).activity = null;
      break;
    }
    case "JOB_EXPIRED":
    case "JOB_CANCELLED":
    case "JOB_FAILED": {
      const job = state.jobs.get(data.jobId);
      job.status = data.terminalStatus;
      job.terminalCause = data.terminalCause;
      job.terminalAt = event.worldTime;
      // A standing post survives a bad outcome the same way it survives a good one. Only a
      // completion used to schedule the reopen, so a worker who accepted a job and then got
      // distracted deleted it from the board for good: three of the pilot's twenty seeded
      // jobs died that way, two to no-shows and one to a cancellation. The post is still
      // needed after nobody turns up - the no-show already costs the worker the grace window
      // and blocks any other commitment during it, which is penalty enough.
      if (job.repeatable) {
        job.reopensAt = new Date(new Date(event.worldTime).getTime()
          + (job.cooldownGameMinutes ?? 0) * 60_000).toISOString();
      }
      job.escrow = 0;
      job.reservation.state = data.workerAmount > 0 ? "split" : "refunded";
      job.reservation.workerAmount = data.workerAmount;
      job.reservation.refundAmount = data.refundAmount;
      if (data.payouts?.length) {
        for (const payout of data.payouts) state.characters.get(payout.workerId).credits += payout.amount;
      } else if (data.workerAmount > 0 && data.workerId) state.characters.get(data.workerId).credits += data.workerAmount;
      if (job.fundingSourceType === "system_budget") {
        state.systemBudgets.get(job.fundingSourceId).balance += data.refundAmount;
      } else {
        state.characters.get(job.fundingSourceId).credits += data.refundAmount;
      }
      for (const workerId of data.workerIds ?? [data.workerId].filter(Boolean)) {
        const worker = state.characters.get(workerId);
        if (worker.activity?.jobId === data.jobId) worker.activity = null;
      }
      break;
    }
    case "REST_STARTED":
      state.characters.get(data.characterId).activity = {
        type: "rest", startedAt: data.startedAt, expectedEndAt: data.expectedEndAt,
        expectedRecovery: data.expectedRecovery, startedByEventId: event.id,
      };
      break;
    case "REST_COMPLETED": {
      const character = state.characters.get(data.characterId);
      character.energy = data.energy;
      character.activity = null;
      break;
    }
    case "EVENT_CREATED":
      state.gatherings.set(data.id, { ...structuredClone(data), attendees: new Set() });
      break;
    case "BUILDING_CONSTRUCTION_STARTED": {
      state.characters.get(data.proprietorId).credits -= data.constructionCost;
      state.buildings.set(data.buildingId, {
        ...structuredClone(data),
        locationId: null, balance: 0, lastUpkeepAt: null, revenue: 0, upkeepPaid: 0,
      });
      // Claiming the cells at the start is what stops a second building being started on
      // the same ground while the first is still going up.
      for (let index = 0; index < data.plotIds.length; index += 1) {
        const [, x, y] = data.plotIds[index].split("-");
        state.plots.set(data.plotIds[index], {
          id: data.plotIds[index], x: Number(x), y: Number(y), buildingId: data.buildingId,
        });
      }
      break;
    }
    case "BUILDING_ACTIVATED": {
      const building = state.buildings.get(data.buildingId);
      building.status = "ACTIVE";
      building.locationId = data.locationId;
      building.activatedAt = data.activatedAt;
      building.lastUpkeepAt = data.activatedAt;
      break;
    }
    case "BUILDING_FUNDED": {
      state.characters.get(data.characterId).credits -= data.credits;
      state.buildings.get(data.buildingId).balance += data.credits;
      break;
    }
    case "BUILDING_UPKEEP_PAID": {
      const building = state.buildings.get(data.buildingId);
      building.balance -= data.fromBalance ?? data.amount;
      if (data.fromProprietor) {
        const proprietor = state.characters.get(data.proprietorId);
        if (proprietor) proprietor.credits -= data.fromProprietor;
      }
      building.upkeepPaid += data.amount;
      building.lastUpkeepAt = data.chargedAt;
      if (building.status === "DELINQUENT") building.status = "ACTIVE";
      break;
    }
    case "BUILDING_UPKEEP_FAILED": {
      const building = state.buildings.get(data.buildingId);
      building.status = "DELINQUENT";
      building.lastUpkeepAt = data.chargedAt;
      building.delinquentSince = data.chargedAt;
      break;
    }
    case "BUILDING_REVENUE_RECORDED": {
      const building = state.buildings.get(data.buildingId);
      if (building) { building.balance += data.amount; building.revenue += data.amount; }
      break;
    }
    case "EVENT_ATTENDANCE_STARTED": {
      state.gatherings.get(data.eventId).attendees.add(data.characterId);
      state.characters.get(data.characterId).activity = {
        type: "attend_event", eventId: data.eventId, title: data.title,
        startedAt: data.startedAt, expectedEndAt: data.expectedEndAt, startedByEventId: event.id,
        compatibleSecondaryActions: ["start_conversation", "send_message", "end_conversation", "appraise_interaction", "leave_experience"],
      };
      const key = experienceAttendanceKey(data.eventId, data.characterId);
      const prior = state.experienceAttendance.get(key);
      // Re-entry keeps accumulating presence against the same unresolved attendance,
      // so one experience resolves once no matter how many times it is entered.
      state.experienceAttendance.set(key, {
        eventId: data.eventId,
        characterId: data.characterId,
        startedAt: data.startedAt,
        endedAt: null,
        accruedMinutes: prior && !prior.resolved ? prior.accruedMinutes : 0,
        conversationTurns: prior && !prior.resolved ? prior.conversationTurns : 0,
        interactions: prior && !prior.resolved ? prior.interactions : {},
        resolved: false,
      });
      break;
    }
    case "EVENT_ATTENDANCE_ENDED": {
      state.characters.get(data.characterId).activity = null;
      const attendance = state.experienceAttendance.get(experienceAttendanceKey(data.eventId, data.characterId));
      if (attendance) {
        attendance.endedAt = data.endedAt ?? event.worldTime;
        attendance.accruedMinutes = data.presenceMinutes ?? attendance.accruedMinutes;
      }
      break;
    }
    case "EXPERIENCE_ACCESS_PAID": {
      state.characters.get(data.characterId).credits -= data.price;
      if (data.destinationType === "system_budget") {
        const budget = state.systemBudgets.get(data.destinationId);
        if (budget) budget.balance += data.price;
      } else if (data.destinationType === "building") {
        const building = state.buildings.get(data.destinationId);
        if (building) { building.balance += data.price; building.revenue += data.price; }
      } else {
        const proprietor = state.characters.get(data.destinationId);
        if (proprietor) proprietor.credits += data.price;
      }
      break;
    }
    case "EXPERIENCE_HAPPINESS_RESOLVED": {
      const attendance = state.experienceAttendance.get(experienceAttendanceKey(data.eventId, data.characterId));
      if (attendance) attendance.resolved = true;
      // The repetition window reads this list, so a resolution has to be remembered
      // even after the attendance itself stops mattering.
      const history = state.happinessResolutions.get(data.characterId) ?? [];
      history.push({
        eventId: data.eventId, locationId: data.locationId,
        dominantDimension: data.dominantDimension ?? null, worldTime: event.worldTime,
      });
      state.happinessResolutions.set(data.characterId, history);
      break;
    }
    case "RELATIONSHIP_APPRAISAL_RECORDED": {
      // The brain declares the outcome of the interaction; no server-side classifier is
      // needed, and a bad exchange can now make the evening worse.
      const perceiver = state.characters.get(data.fromId);
      if (perceiver?.activity?.type === "attend_event") {
        const attending = state.experienceAttendance.get(experienceAttendanceKey(perceiver.activity.eventId, data.fromId));
        const existing = attending && !attending.resolved ? attending.interactions[data.toId] : null;
        if (existing) {
          existing.appraisal = data.appraisal;
          existing.interactionKind = data.interactionKind;
        }
      }
      break;
    }
    case "HAPPINESS_CHANGED": {
      const character = state.characters.get(data.characterId);
      character.happiness = data.value;
      character.livedHappiness = round2((character.livedHappiness ?? 0) + (data.livedDelta ?? 0));
      break;
    }
    case "HAPPINESS_DECAYED": {
      const character = state.characters.get(data.characterId);
      character.happiness = data.value;
      character.lastHappinessDecayAt = event.worldTime;
      break;
    }
    case "INVITATION_SENT":
      state.invitations.set(data.invitationId, {
        id: data.invitationId, ...structuredClone(data), status: "pending", sentByEventId: event.id,
      });
      break;
    case "INVITATION_ACCEPTED":
      state.invitations.get(data.invitationId).status = "accepted";
      state.invitations.get(data.invitationId).respondedAt = data.respondedAt;
      break;
    case "INVITATION_DECLINED":
      state.invitations.get(data.invitationId).status = "declined";
      state.invitations.get(data.invitationId).respondedAt = data.respondedAt;
      break;
    case "INVITATION_EXPIRED":
      state.invitations.get(data.invitationId).status = "expired";
      state.invitations.get(data.invitationId).respondedAt = event.worldTime;
      break;
    case "COMMITMENT_CREATED":
      state.commitments.set(data.commitmentId, {
        id: data.commitmentId, ...structuredClone(data), reminderSentAt: null,
        createdByEventId: event.id,
      });
      break;
    case "COMMITMENT_REMINDER_SENT":
      state.commitments.get(data.commitmentId).reminderSentAt = event.worldTime;
      break;
    case "COMMITMENT_WINDOW_OPENED":
      state.commitments.get(data.commitmentId).status = "active";
      break;
    case "COMMITMENT_KEPT":
      state.commitments.get(data.commitmentId).status = "kept";
      state.commitments.get(data.commitmentId).resolvedAt = event.worldTime;
      break;
    case "COMMITMENT_MISSED":
      state.commitments.get(data.commitmentId).status = "missed";
      state.commitments.get(data.commitmentId).resolvedAt = event.worldTime;
      state.commitments.get(data.commitmentId).presentIds = [...data.presentIds];
      state.commitments.get(data.commitmentId).absentIds = [...data.absentIds];
      break;
    case "CONVERSATION_STARTED":
      state.conversations.set(data.conversationId, {
        id: data.conversationId, initiatorId: data.initiatorId,
        participantIds: [...data.participantIds], locationId: data.locationId,
        startedAt: data.startedAt, endedAt: null, status: "active", messages: [],
        expectedResponderId: data.targetId,
        startedByEventId: event.id, lastEventId: event.id,
      });
      break;
    case "CONVERSATION_MESSAGE_SENT": {
      // Verified interaction: only turns this character itself took, and only while it
      // was actually present at an experience. Tracked per counterpart, because whom
      // you talked to is what makes the evening good or bad.
      const speaker = state.characters.get(data.senderId ?? event.actorCharacterId);
      if (speaker?.activity?.type === "attend_event") {
        const attending = state.experienceAttendance.get(experienceAttendanceKey(speaker.activity.eventId, speaker.id));
        if (attending && !attending.resolved) {
          attending.conversationTurns += 1;
          for (const otherId of data.participantIds ?? []) {
            if (otherId === speaker.id) continue;
            const existing = attending.interactions[otherId] ?? { turns: 0, appraisal: null, interactionKind: null, topics: [] };
            existing.turns += 1;
            for (const topic of data.topics ?? []) {
              if (!existing.topics.includes(topic)) existing.topics.push(topic);
            }
            attending.interactions[otherId] = existing;
          }
        }
      }
      const conversation = state.conversations.get(data.conversationId);
      conversation.messages.push({
        id: data.messageId, senderId: data.senderId, text: data.text,
        sharedFacts: structuredClone(data.sharedFacts), sentAt: event.worldTime,
      });
      conversation.expectedResponderId = conversation.participantIds.find((id) => id !== data.senderId);
      conversation.lastEventId = event.id;
      break;
    }
    case "CONVERSATION_ENDED": {
      const conversation = state.conversations.get(data.conversationId);
      conversation.status = "ended";
      conversation.endedAt = event.worldTime;
      conversation.endReason = data.reason ?? "participant_ended";
      break;
    }
    case "KNOWLEDGE_LEARNED":
      state.knowledge.get(data.characterId).set(`${data.fact.id}:${data.sourceCharacterId}:${data.messageId}`, {
        ...structuredClone(data.fact), sourceCharacterId: data.sourceCharacterId,
        messageId: data.messageId, learnedAt: event.worldTime, provenance: "reported",
      });
      break;
    case "AGENT_NOTIFICATION_QUEUED":
      state.notifications.set(event.id, {
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
      const notification = state.notifications.get(data.notificationEventId);
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
      const notification = state.notifications.get(data.notificationEventId);
      notification.deliveryAttempts += 1;
      notification.lastDeliveryFailureAt = event.worldTime;
      notification.lastDeliveryFailureCode = data.failureCode;
      break;
    }
    case "AGENT_NOTIFICATION_ACKNOWLEDGED": {
      const notification = state.notifications.get(data.notificationEventId);
      notification.status = "acknowledged";
      notification.ackEventId = event.id;
      break;
    }
    case "AGENT_NOTIFICATION_RESOLVED": {
      const notification = state.notifications.get(data.notificationEventId);
      notification.status = data.status;
      notification.resolutionEventId = data.resolutionEventId;
      notification.outcome = data.outcome;
      break;
    }
    case "AGENT_NOTIFICATION_EXPIRED": {
      const notification = state.notifications.get(data.notificationEventId);
      notification.status = "expired";
      notification.outcome = data.outcome;
      notification.expiredAt = event.worldTime;
      break;
    }
    case "AGENT_RESPONSE_MISSED": {
      const character = state.characters.get(data.characterId);
      character.consecutiveMissedResponses = data.consecutiveMissedResponses;
      character.agentAvailability = data.availability;
      break;
    }
    case "AGENT_RECOVERY_VERIFIED": {
      const character = state.characters.get(data.characterId);
      character.consecutiveMissedResponses = 0;
      character.agentAvailability = "available";
      break;
    }
    case "PLATFORM_INCIDENT_CONFIRMED":
      state.platformIncident = {
        id: data.incidentId, eventId: event.id,
        startedAtWorld: data.startedAtWorld, startedAtReal: data.startedAtReal,
      };
      break;
    case "PLATFORM_INCIDENT_RESOLVED":
      state.platformIncident = null;
      break;
    case "DEADLINE_SUPPRESSED_FOR_PLATFORM_INCIDENT": {
      const notification = state.notifications.get(data.notificationEventId);
      notification.respondByWorldTime = data.respondByWorldTime;
      notification.respondByRealTime = data.respondByRealTime;
      notification.lastSuppressedIncidentId = data.incidentId;
      break;
    }
    case "JOB_DEADLINE_EXTENDED_FOR_PLATFORM_INCIDENT": {
      const job = state.jobs.get(data.jobId);
      job.offerExpiresAt = data.offerExpiresAt;
      job.availableUntil = data.offerExpiresAt;
      job.scheduledStartAt = data.scheduledStartAt;
      job.availableFrom = data.scheduledStartAt;
      job.startGraceUntil = data.startGraceUntil;
      job.reservation.expiresAt = data.offerExpiresAt;
      break;
    }
    case "CONVERSATION_RESPONSE_RECORDED": {
      const character = state.characters.get(data.characterId);
      if (character.agentAvailability !== "unavailable") character.consecutiveMissedResponses = 0;
      break;
    }
    case "SECONDARY_GOAL_ADOPTED":
      state.characters.get(data.characterId).secondaryGoals.push(structuredClone(data.goal));
      break;
    case "SECONDARY_GOAL_COMPLETED": {
      const goal = state.characters.get(data.characterId).secondaryGoals.find((item) => item.id === data.goalId);
      goal.status = "completed";
      goal.completedAt = event.worldTime;
      goal.evidenceEventId = data.evidenceEventId;
      break;
    }
    case "SECONDARY_GOAL_ABANDONED": {
      const goal = state.characters.get(data.characterId).secondaryGoals.find((item) => item.id === data.goalId);
      goal.status = "abandoned";
      goal.abandonedAt = event.worldTime;
      break;
    }
    case "SECONDARY_GOAL_EXPIRED": {
      const goal = state.characters.get(data.characterId).secondaryGoals.find((item) => item.id === data.goalId);
      goal.status = "expired";
      goal.expiredAt = event.worldTime;
      break;
    }
    case "RETURN_SUMMARY_AVAILABLE":
      state.returnSummaries.set(data.summary.id, structuredClone(data.summary));
      break;
    case "STORY_DETAIL_VIEWED":
      state.storyDetailViews.add(`${data.ownerId}:${data.characterId}:${data.detailEventId}`);
      break;
    case "STORY_INTEREST_RATED":
      state.storyRatings.set(`${data.ownerId}:${data.characterId}:${data.detailEventId}`, data.rating);
      break;
    case "AGENT_ACTION_PROCESSED":
      state.actionReceipts.set(`${data.characterId}:${data.idempotencyKey}`, structuredClone(data));
      break;
  }
}

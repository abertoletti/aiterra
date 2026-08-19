// The event reducer: the single place where an applied event changes world state.
// It receives state rather than the World instance, so folding an event can never
// reach a command, the clock, or the store, and a replay is exactly this function
// run over the history in order.
import { coPresenceKey, relationshipKey } from "./world-support.js";

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
    case "JOB_COMPLETED": {
      const job = state.jobs.get(data.jobId);
      job.status = "completed";
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
    case "EVENT_ATTENDANCE_STARTED": {
      state.gatherings.get(data.eventId).attendees.add(data.characterId);
      state.characters.get(data.characterId).activity = {
        type: "attend_event", eventId: data.eventId, title: data.title,
        startedAt: data.startedAt, expectedEndAt: data.expectedEndAt, startedByEventId: event.id,
        compatibleSecondaryActions: ["start_conversation", "send_message", "end_conversation", "appraise_interaction"],
      };
      break;
    }
    case "EVENT_ATTENDANCE_ENDED":
      state.characters.get(data.characterId).activity = null;
      break;
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

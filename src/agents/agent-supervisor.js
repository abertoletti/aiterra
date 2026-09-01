import { AiterraProtocolError } from "./aiterra-agent-client.js";
import { DecisionValidationError, safeFallbackAction } from "./decision-planner.js";

export class AgentSupervisor {
  constructor({
    agents, planner, concurrency = null, pollIntervalMs = 5_000,
    decisionCooldownMs = 500, maximumActionsPerCycle = 3,
    modelCallsPerWindow = 10, modelCallWindowMs = 60_000,
    reconnectDelayMs = 2_000, logger = console,
    contextMode = "progressive", contextRequestsPerDecision = 1,
  }) {
    if (!Array.isArray(agents) || agents.length === 0) throw new Error("At least one agent is required");
    if (!planner || typeof planner.decide !== "function") throw new Error("An agent decision planner is required");
    this.agents = agents;
    this.planner = planner;
    this.pollIntervalMs = positiveInteger(pollIntervalMs, "pollIntervalMs");
    this.decisionCooldownMs = nonNegativeInteger(decisionCooldownMs, "decisionCooldownMs");
    this.maximumActionsPerCycle = positiveInteger(maximumActionsPerCycle, "maximumActionsPerCycle");
    this.modelCallsPerWindow = positiveInteger(modelCallsPerWindow, "modelCallsPerWindow");
    this.modelCallWindowMs = positiveInteger(modelCallWindowMs, "modelCallWindowMs");
    this.reconnectDelayMs = positiveInteger(reconnectDelayMs, "reconnectDelayMs");
    if (!["full", "progressive"].includes(contextMode)) throw new Error("contextMode must be full or progressive");
    this.contextMode = contextMode;
    this.contextRequestsPerDecision = nonNegativeInteger(contextRequestsPerDecision, "contextRequestsPerDecision");
    this.logger = logger;
    // One slot per agent by default. A tighter cap was the binding constraint on
    // response time - two slots across seven agents ceilinged the world at 23 model
    // calls a minute against a 70-a-minute rate limit, and made the seventh agent wait
    // 13 seconds before its call even started. The rate limiter is the real throttle.
    this.semaphore = new Semaphore(positiveInteger(concurrency ?? agents.length, "concurrency"));
    this.abortController = new AbortController();
    this.running = false;
    this.modelCalls = 0;
    this.startedAt = null;
    this.stoppedAt = null;
    this.states = new Map(agents.map((agent) => {
      const state = createAgentState(agent.characterId);
      state.modelRateLimiter = new SlidingWindowRateLimiter(this.modelCallsPerWindow, this.modelCallWindowMs);
      return [agent.characterId, state];
    }));
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date().toISOString();
    await Promise.all(this.agents.map(async (agent) => {
      const health = await agent.client.health({ signal: this.abortController.signal });
      if (!health.compatible) throw new Error(`Agent ${agent.characterId} is incompatible with protocol ${health.protocolVersion}`);
      this.log("info", agent.characterId, "agent_ready", null, { protocolVersion: health.protocolVersion });
    }));
    for (const agent of this.agents) {
      const state = this.states.get(agent.characterId);
      state.eventLoop = this.runEventLoop(agent, state);
    }
    await Promise.all([...this.states.values()].map((state) => state.eventReady));
    for (const agent of this.agents) {
      const state = this.states.get(agent.characterId);
      state.pollTimer = setInterval(() => this.enqueueDecision(agent, "poll"), this.pollIntervalMs);
      this.enqueueDecision(agent, "startup");
    }
  }

  async runFor(durationMs) {
    await this.start();
    try {
      await sleep(positiveInteger(durationMs, "durationMs"), this.abortController.signal);
    } catch (error) {
      if (!this.abortController.signal.aborted) throw error;
    } finally {
      await this.stop();
    }
    return this.report();
  }

  async stop() {
    if (!this.running && this.stoppedAt) return;
    this.running = false;
    for (const state of this.states.values()) clearInterval(state.pollTimer);
    this.abortController.abort();
    await Promise.allSettled([...this.states.values()].flatMap((state) => [state.eventLoop, state.decisionTask]).filter(Boolean));
    await this.closeActiveConversations();
    this.stoppedAt = new Date().toISOString();
  }

  async drain() {
    await Promise.allSettled([...this.states.values()].map((state) => state.decisionTask).filter(Boolean));
  }

  report() {
    const agents = Object.fromEntries([...this.states.entries()].map(([characterId, state]) => [characterId, { ...state.stats }]));
    const conversationEnergySpent = Object.values(agents)
      .reduce((total, agent) => total + agent.conversationEnergySpent, 0);
    const conversationsStarted = Object.values(agents)
      .reduce((total, agent) => total + Number(agent.actionsByType.start_conversation ?? 0), 0);
    return {
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      modelCalls: this.modelCalls,
      modelRateLimit: {
        callsPerAgent: this.modelCallsPerWindow,
        windowMs: this.modelCallWindowMs,
      },
      usage: Object.values(agents).reduce((total, agent) => ({
        promptTokens: total.promptTokens + agent.usage.promptTokens,
        completionTokens: total.completionTokens + agent.usage.completionTokens,
        totalTokens: total.totalTokens + agent.usage.totalTokens,
      }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
      socialEnergy: {
        conversationEnergySpent,
        conversationsStarted,
        averageEnergyPerStartedConversation: conversationsStarted > 0
          ? conversationEnergySpent / conversationsStarted
          : null,
        interactionsRejectedForEnergy: Object.values(agents)
          .reduce((total, agent) => total + Number(agent.actionRejectionsByCode.INSUFFICIENT_ENERGY ?? 0), 0),
      },
      agents,
    };
  }

  enqueueDecision(agent, trigger) {
    if (!this.running) return;
    const state = this.states.get(agent.characterId);
    state.pendingDecision = true;
    state.lastTrigger = trigger;
    if (state.decisionRunning) return;
    state.decisionRunning = true;
    state.decisionTask = (async () => {
      while (this.running && state.pendingDecision) {
        state.pendingDecision = false;
        await this.runDecisionCycle(agent, state);
      }
    })().catch((error) => {
      if (!this.abortController.signal.aborted) {
        state.stats.runtimeErrors += 1;
        this.log("error", agent.characterId, "decision_cycle_failed", error);
      }
    }).finally(() => {
      state.decisionRunning = false;
    });
  }

  // One observation, plus the two things a progressive runtime owns: echoing back the
  // contextVersion it already holds so the server sends a delta, and keeping the rule
  // manifest cached by version instead of receiving its body every time.
  async observeWithContext(agent, state) {
    const observation = await agent.client.observe({
      signal: this.abortController.signal,
      contextMode: this.contextMode,
      contextVersion: state.contextVersion ?? 0,
    });
    state.contextVersion = observation.contextVersion ?? 0;
    if (observation.rulesVersion && state.rulesVersion !== observation.rulesVersion) {
      state.rules = observation.rules ?? await agent.client.rules({ signal: this.abortController.signal });
      state.rulesVersion = observation.rulesVersion;
      this.log("info", agent.characterId, "agent_rules_cached", null, {
        rulesVersion: observation.rulesVersion, embedded: Boolean(observation.rules),
      });
    }
    state.stats.observations += 1;
    state.stats.observationBytes += JSON.stringify(observation).length;
    return observation;
  }

  async runDecisionCycle(agent, state) {
    let validationRepairs = 0;
    for (let actionIndex = 0; actionIndex < this.maximumActionsPerCycle && this.running; actionIndex += 1) {
      let observation = await this.observeWithContext(agent, state);
      const acknowledged = await this.acknowledgeDeliveredNotifications(agent, state, observation);
      if (acknowledged > 0) observation = await this.observeWithContext(agent, state);
      this.recordObservation(agent, state, observation);
      if (!observation.decision?.requiredNow) return;
      // A changing clock alone must not buy another identical failed inference.
      const decisionFingerprint = actionableStateFingerprint(observation);
      if (state.blockedDecisionFingerprint === decisionFingerprint) return;
      state.blockedDecisionFingerprint = null;

      const waitedMs = await state.modelRateLimiter.waitForAvailability(this.abortController.signal, ({ waitMs, callsInWindow }) => {
        state.stats.rateLimitWaits += 1;
        state.stats.rateLimitWaitMilliseconds += waitMs;
        this.log("info", agent.characterId, "model_rate_limited", null, {
          waitMs,
          callsInWindow,
          callsPerWindow: this.modelCallsPerWindow,
          windowMs: this.modelCallWindowMs,
          characterName: observation.character?.name,
        });
      });
      if (waitedMs > 0) {
        observation = await this.observeWithContext(agent, state);
        const acknowledgedAfterWait = await this.acknowledgeDeliveredNotifications(agent, state, observation);
        if (acknowledgedAfterWait > 0) observation = await this.observeWithContext(agent, state);
        this.recordObservation(agent, state, observation);
        if (!observation.decision?.requiredNow) return;
      }
      state.modelRateLimiter.consume();

      this.log("info", agent.characterId, "decision_required", null, {
        trigger: state.lastTrigger,
        reason: observation.decision?.reason,
        notificationEventId: observation.decision?.notificationEventId,
        worldTime: observation.worldTime,
        characterName: observation.character?.name,
      });

      const history = await agent.client.history(40, { signal: this.abortController.signal });
      let action;
      try {
        // The brain may ask for a catalog instead of acting, within a budget. Each
        // request costs one model call, which is why the budget is small and why the
        // request rate is reported: a runtime that asks every time has reproduced the
        // problem progressive context exists to remove.
        const catalogs = {};
        const buildingQuotes = [];
        let contextRequestsRemaining = this.contextRequestsPerDecision;
        let buildingQuoteRequestsRemaining = 1;
        let decision;
        const maximumInformationRequests = this.contextRequestsPerDecision + 1;
        for (let attempt = 0; attempt <= maximumInformationRequests; attempt += 1) {
          if (attempt > 0) state.modelRateLimiter.consume();
          this.modelCalls += 1;
          state.stats.modelCalls += 1;
          decision = await this.semaphore.run(() => this.planner.decide({
            observation, history, recentActionFailures: state.recentActionFailures,
            signal: this.abortController.signal,
            rules: state.rules, catalogs, contextRequestsRemaining,
            buildingQuotes, buildingQuoteRequestsRemaining,
          }));
          addUsage(state.stats.usage, decision.usage);
          if (decision.contextRequest && contextRequestsRemaining > 0) {
            const { resource, filters } = decision.contextRequest;
            contextRequestsRemaining -= 1;
            state.stats.contextRequests += 1;
            state.stats.contextRequestsByResource[resource] = (state.stats.contextRequestsByResource[resource] ?? 0) + 1;
            const page = await agent.client.inspect(resource, { filters, signal: this.abortController.signal });
            catalogs[resource] = page;
            this.log("info", agent.characterId, "decision_context_requested", null, {
              resource, filters, returned: page.returned, count: page.count,
              feasibleCount: page.feasibleCount, blockedCount: page.blockedCount,
              rationale: decision.rationale, characterName: observation.character?.name,
            });
            continue;
          }
          if (decision.buildingQuoteRequest && buildingQuoteRequestsRemaining > 0) {
            buildingQuoteRequestsRemaining -= 1;
            state.stats.buildingQuoteRequests += 1;
            const quote = await agent.client.quoteBuilding(decision.buildingQuoteRequest, {
              signal: this.abortController.signal,
            });
            buildingQuotes.push(quote);
            this.log("info", agent.characterId, "building_quote_requested", null, {
              proposal: decision.buildingQuoteRequest,
              quoteEventId: quote.quoteEventId,
              constructionCost: quote.constructionCost,
              upkeepPerInterval: quote.upkeepPerInterval,
              availableCredits: quote.availableCredits,
              creditsAfterConstruction: quote.creditsAfterConstruction,
              feasibility: quote.feasibility,
              rationale: decision.rationale,
              characterName: observation.character?.name,
            });
            continue;
          }
          break;
        }
        action = decision.action;
        this.log("verbose", agent.characterId, "model_response_received", null, {
          content: decision.rawContent,
          providerResponseId: decision.providerResponseId,
          usage: decision.usage,
          characterName: observation.character?.name,
        });
        // The instructions themselves, recorded once per distinct prompt rather than on
        // every decision: a run's log should be able to answer "what was it told" without
        // carrying five kilobytes per turn.
        if (decision.systemPromptDigest && state.loggedPromptDigest !== decision.systemPromptDigest) {
          state.loggedPromptDigest = decision.systemPromptDigest;
          this.log("info", agent.characterId, "system_prompt", null, {
            digest: decision.systemPromptDigest,
            systemPrompt: decision.systemPrompt,
            characterName: observation.character?.name,
          });
        }
        this.log("info", agent.characterId, "model_decision", null, {
          action,
          rationale: decision.rationale,
          usage: decision.usage,
          systemPromptDigest: decision.systemPromptDigest,
          characterName: observation.character?.name,
        });
      } catch (error) {
        if (this.abortController.signal.aborted) return;
        if (error instanceof DecisionValidationError) {
          state.stats.validationFailures += 1;
          addUsage(state.stats.usage, error.usage);
          const candidate = error.rejectedAction ?? null;
          state.recentActionFailures.push({
            at: new Date().toISOString(), worldTime: observation.worldTime,
            stateVersion: observation.stateVersion, action: candidate,
            actionIdentity: actionIdentity(candidate), actionFingerprint: actionFingerprint(candidate),
            code: error.code, message: error.message, stage: "local_validation",
            allowedActions: (observation.availableActions ?? []).filter((item) => !candidate?.type || item.type === candidate.type),
          });
          state.recentActionFailures = state.recentActionFailures.slice(-5);
          if (error.rawModelContent) {
            this.log("verbose", agent.characterId, "model_response_invalid", null, {
              content: error.rawModelContent,
              validationError: error.message,
              providerResponseId: error.providerResponseId,
              usage: error.usage,
              characterName: observation.character?.name,
            });
          }
          this.log("warn", agent.characterId, "model_decision_failed", error);
          if (validationRepairs < 1 && actionIndex + 1 < this.maximumActionsPerCycle) {
            validationRepairs += 1;
            state.stats.validationRepairs += 1;
            continue;
          }
          state.blockedDecisionFingerprint = actionableStateFingerprint(observation);
          return;
        }
        else state.stats.modelErrors += 1;
        this.log("warn", agent.characterId, "model_decision_failed", error);
        action = safeFallbackAction(observation);
        if (!action) return;
        state.stats.fallbackActions += 1;
        this.log("info", agent.characterId, "fallback_action", null, {
          action,
          characterName: observation.character?.name,
        });
      }

      state.actionSequence += 1;
      const repeatedFailure = state.recentActionFailures.findLast((failure) =>
        failure.stateVersion === observation.stateVersion && failure.actionFingerprint === actionFingerprint(action));
      if (repeatedFailure) {
        state.stats.suppressedRepeatedActions += 1;
        // Without this the next prompt is byte-identical apart from worldTime and the
        // model answers identically, so one suppression becomes a loop of full-price
        // calls until the world happens to move.
        state.recentActionFailures.push({
          stateVersion: observation.stateVersion,
          actionIdentity: actionIdentity(action),
          actionFingerprint: actionFingerprint(action),
          type: action.type,
          code: "SUPPRESSED_DUPLICATE",
          message: "This exact action was already refused at this state version. Choose a different action, or change a field the server objected to.",
        });
        this.log("warn", agent.characterId, "action_retry_suppressed", null, {
          action,
          stateVersion: observation.stateVersion,
          previousErrorCode: repeatedFailure.code,
          characterName: observation.character?.name,
        });
        state.blockedDecisionFingerprint = actionableStateFingerprint(observation);
        return;
      }
      const idempotencyKey = `${agent.characterId}-${Date.now()}-${state.actionSequence}`.slice(0, 100);
      let result;
      try {
        result = await agent.client.submitAction(action, observation.stateVersion, idempotencyKey, {
          signal: this.abortController.signal,
        });
      } catch (error) {
        if (error instanceof AiterraProtocolError && error.code === "STALE_STATE_VERSION") {
          state.stats.staleRetries += 1;
          continue;
        }
        if (error instanceof AiterraProtocolError && ["REACTION_WINDOW_EXPIRED", "NOTIFICATION_RESOLVED", "CONVERSATION_ENDED"].includes(error.code)) {
          state.stats.conflictSkips += 1;
          return;
        }
        if (error instanceof AiterraProtocolError) {
          state.stats.actionRejections += 1;
          state.stats.actionRejectionsByCode[error.code] = (state.stats.actionRejectionsByCode[error.code] ?? 0) + 1;
          state.recentActionFailures.push({
            at: new Date().toISOString(),
            worldTime: observation.worldTime,
            stateVersion: observation.stateVersion,
            action: structuredClone(action),
            actionIdentity: actionIdentity(action),
            actionFingerprint: actionFingerprint(action),
            code: error.code,
            message: error.message,
          });
          state.recentActionFailures = state.recentActionFailures.slice(-5);
          this.log("warn", agent.characterId, "action_rejected", error, {
            action,
            stateVersion: observation.stateVersion,
            characterName: observation.character?.name,
          });
          return;
        }
        throw error;
      }
      state.stats.acceptedActions += 1;
      state.stats.actionsByType[action.type] = (state.stats.actionsByType[action.type] ?? 0) + 1;
      if (["start_conversation", "send_message"].includes(action.type)) {
        const template = (observation.availableActions ?? []).find((item) => actionIdentity(item) === actionIdentity(action));
        state.stats.conversationEnergySpent += finiteNumber(template?.energyCost);
      }
      this.log("info", agent.characterId, "action_accepted", null, {
        action,
        decisionRequiredNow: result.decisionRequiredNow,
        stateVersion: result.stateVersion,
        characterName: observation.character?.name,
      });
      if (!result.decisionRequiredNow) return;
      await sleep(this.decisionCooldownMs, this.abortController.signal);
    }
  }

  async acknowledgeDeliveredNotifications(agent, state, observation) {
    let acknowledged = 0;
    for (const notification of observation.pendingNotifications ?? []) {
      if (!notification.deliveredEventId || notification.ackEventId) continue;
      try {
        await agent.client.acknowledge(notification.eventId, { signal: this.abortController.signal });
        state.stats.acknowledgedNotifications += 1;
        acknowledged += 1;
        this.log("info", agent.characterId, "notification_acknowledged", null, {
          notificationEventId: notification.eventId,
          requestKind: notification.requestKind,
        });
      } catch (error) {
        if (!(error instanceof AiterraProtocolError)
          || !["NOTIFICATION_RESOLVED", "NOTIFICATION_NOT_DELIVERED"].includes(error.code)) throw error;
      }
    }
    return acknowledged;
  }

  async closeActiveConversations() {
    for (const agent of this.agents) {
      try {
        let observation = await agent.client.observe();
        for (const conversation of observation.activeConversations ?? []) {
          const coordinatorId = [...conversation.participantIds].sort()[0];
          if (agent.characterId !== coordinatorId) continue;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              const idempotencyKey = `${agent.characterId}-pilot-stop-${conversation.id}-${attempt}`.slice(0, 100);
              await agent.client.submitAction(
                { type: "end_conversation", conversationId: conversation.id },
                observation.stateVersion,
                idempotencyKey,
              );
              const state = this.states.get(agent.characterId);
              state.stats.gracefulConversationClosures += 1;
              this.log("info", agent.characterId, "graceful_conversation_closed", null, {
                conversationId: conversation.id,
                characterName: observation.character?.name,
              });
              break;
            } catch (error) {
              if (error instanceof AiterraProtocolError && error.code === "STALE_STATE_VERSION" && attempt === 0) {
                observation = await agent.client.observe();
                continue;
              }
              if (!(error instanceof AiterraProtocolError && error.code === "CONVERSATION_ENDED")) {
                this.log("warn", agent.characterId, "graceful_conversation_close_failed", error, {
                  conversationId: conversation.id,
                  characterName: observation.character?.name,
                });
              }
              break;
            }
          }
        }
      } catch (error) {
        this.log("warn", agent.characterId, "graceful_shutdown_observation_failed", error);
      }
    }
  }

  recordObservation(agent, state, observation) {
    this.log("verbose", agent.characterId, "observation_received", null, {
      observation,
      characterName: observation.character?.name,
    });
    for (const conversation of observation.activeConversations ?? []) {
      for (const message of conversation.messages ?? []) {
        if (!message.id || state.seenConversationMessageIds.has(message.id)) continue;
        state.seenConversationMessageIds.add(message.id);
        this.log("info", agent.characterId, "conversation_message_seen", null, {
          conversationId: conversation.id,
          messageId: message.id,
          senderId: message.senderId,
          text: message.text,
          sharedFacts: message.sharedFacts,
          characterName: observation.character?.name,
        });
      }
    }
  }

  async runEventLoop(agent, state) {
    while (this.running && !this.abortController.signal.aborted) {
      try {
        await agent.client.streamEvents({
          signal: this.abortController.signal,
          onOpen: () => {
            if (state.eventStreamOpened) return;
            state.eventStreamOpened = true;
            state.resolveEventReady();
            this.log("info", agent.characterId, "event_stream_opened");
          },
          onEvent: async (event) => {
            if (event.event !== "relevant-event") return;
            state.stats.receivedEvents += 1;
            this.log("info", agent.characterId, "relevant_event_received", null, {
              notificationEventId: event.data?.id,
              sourceEventId: event.data?.sourceEventId,
              requestKind: event.data?.requestKind,
              summary: event.data?.summary,
            });
            this.enqueueDecision(agent, "sse");
          },
        });
      } catch (error) {
        if (this.abortController.signal.aborted) return;
        if (!state.eventStreamOpened) {
          state.rejectEventReady(error);
          return;
        }
        state.stats.eventStreamReconnects += 1;
        this.log("warn", agent.characterId, "event_stream_disconnected", error);
      }
      if (this.running) await sleep(this.reconnectDelayMs, this.abortController.signal);
    }
  }

  log(level, characterId, event, error = null, details = null) {
    const writer = typeof this.logger?.[level] === "function" ? this.logger[level].bind(this.logger) : this.logger?.log?.bind(this.logger);
    writer?.(JSON.stringify({
      timestamp: new Date().toISOString(), level, characterId, event,
      details,
      error: error ? { name: error.name, code: error.code ?? null, message: error.message } : null,
    }));
  }
}

function createAgentState(characterId) {
  let resolveEventReady;
  let rejectEventReady;
  const eventReady = new Promise((resolve, reject) => {
    resolveEventReady = resolve;
    rejectEventReady = reject;
  });
  return {
    characterId,
    pendingDecision: false,
    decisionRunning: false,
    decisionTask: null,
    eventLoop: null,
    eventReady,
    resolveEventReady,
    rejectEventReady,
    eventStreamOpened: false,
    pollTimer: null,
    lastTrigger: null,
    modelRateLimiter: null,
    seenConversationMessageIds: new Set(),
    recentActionFailures: [],
    blockedDecisionFingerprint: null,
    actionSequence: 0,
    stats: {
      modelCalls: 0, acceptedActions: 0, receivedEvents: 0, acknowledgedNotifications: 0,
      fallbackActions: 0, validationFailures: 0, validationRepairs: 0, modelErrors: 0, runtimeErrors: 0,
      staleRetries: 0, conflictSkips: 0, eventStreamReconnects: 0,
      actionRejections: 0, suppressedRepeatedActions: 0, gracefulConversationClosures: 0,
      actionRejectionsByCode: {},
      conversationEnergySpent: 0,
      rateLimitWaits: 0, rateLimitWaitMilliseconds: 0,
      contextRequests: 0, contextRequestsByResource: {}, buildingQuoteRequests: 0,
      observationBytes: 0, observations: 0,
      actionsByType: {},
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
  };
}

function addUsage(target, usage) {
  if (!usage || typeof usage !== "object") return;
  target.promptTokens += finiteNumber(usage.prompt_tokens ?? usage.input_tokens);
  target.completionTokens += finiteNumber(usage.completion_tokens ?? usage.output_tokens);
  target.totalTokens += finiteNumber(usage.total_tokens)
    || finiteNumber(usage.prompt_tokens ?? usage.input_tokens) + finiteNumber(usage.completion_tokens ?? usage.output_tokens);
}

// The suppressor asks "is this the same attempt again", which is a different question
// from "which affordance was this" - and actionIdentity answers the second. For
// acquire_plot, construct_building and rest it has no target at all, so one rejection
// used to lock out the entire action type until the world moved. Kept separate because
// actionIdentity still matches an accepted action to its affordance template to read
// energyCost, and templates carry no free-text fields.
function actionableStateFingerprint(observation) {
  return JSON.stringify({
    character: observation.character, nearby: observation.nearby,
    availableActions: observation.availableActions, opportunities: observation.opportunities,
    cannotRightNow: observation.cannotRightNow, pendingNotifications: observation.pendingNotifications,
    activeConversations: observation.activeConversations, known: observation.known,
    cityTonight: observation.cityTonight, decisionReason: observation.decision?.reason,
  });
}

function actionFingerprint(action) {
  if (!action || typeof action !== "object") return "unknown";
  return JSON.stringify(Object.keys(action).sort().map((key) => [key, action[key]]));
}

function actionIdentity(action) {
  if (!action || typeof action !== "object") return "unknown";
  const target = action.destinationId ?? action.targetCharacterId ?? action.jobId ?? action.eventId
    ?? action.courseId ?? action.applicationId
    ?? action.otherCharacterId ?? action.goalId ?? action.notificationEventId ?? action.conversationId ?? "";
  return `${action.type ?? "unknown"}:${target}`;
}

function finiteNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

class Semaphore {
  constructor(capacity) {
    this.capacity = capacity;
    this.active = 0;
    this.waiters = [];
  }

  async run(operation) {
    await this.acquire();
    try { return await operation(); } finally { this.release(); }
  }

  acquire() {
    if (this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }
}

export class SlidingWindowRateLimiter {
  constructor(limit, windowMs, { now = Date.now, delay = sleep } = {}) {
    this.limit = positiveInteger(limit, "limit");
    this.windowMs = positiveInteger(windowMs, "windowMs");
    this.now = now;
    this.delay = delay;
    this.timestamps = [];
  }

  async waitForAvailability(signal = null, onWait = null) {
    let totalWaitMs = 0;
    while (true) {
      const now = this.now();
      this.prune(now);
      if (this.timestamps.length < this.limit) return totalWaitMs;
      const waitMs = Math.max(1, this.timestamps[0] + this.windowMs - now);
      onWait?.({ waitMs, callsInWindow: this.timestamps.length });
      await this.delay(waitMs, signal);
      totalWaitMs += waitMs;
    }
  }

  consume() {
    const now = this.now();
    this.prune(now);
    if (this.timestamps.length >= this.limit) throw new Error("Model rate-limit slot is not available");
    this.timestamps.push(now);
  }

  prune(now) {
    const threshold = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= threshold) this.timestamps.shift();
  }
}

function sleep(milliseconds, signal) {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const timeout = setTimeout(() => finish(resolve), milliseconds);
    const abort = () => finish(reject, signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

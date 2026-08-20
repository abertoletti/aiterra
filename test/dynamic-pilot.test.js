import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock, addGameMinutes } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

test("versioned agent rules disclose the authoritative eight-turn and fatigue contract", () => {
  const { world } = dynamicWorld();
  const observation = world.getObservation("aria");

  assert.equal(observation.rulesVersion, "agent-rules-v4");
  assert.equal(observation.rules.conversations.maximumTurns, 8);
  assert.equal(observation.rules.energy.extendedConversationStartsAtTurn, 5);
  assert.equal(observation.rules.energy.extendedConversationTurnCost, 2);
  assert.equal(observation.rules.conversations.samePairCooldownWorldMinutes, 30);
  assert.equal(observation.rules.authority.serverAuthoritative, true);
});

test("conversation energy rises after turn four and the same pair enters cooldown and fatigue", () => {
  const { world, clock } = dynamicWorld();
  const conversation = world.startConversation("aria", "borin", "One");
  for (let turn = 2; turn <= 8; turn += 1) {
    world.sendMessage(turn % 2 === 0 ? "borin" : "aria", conversation.data.conversationId, `Turn ${turn}`);
  }

  assert.equal(world.getObservation("aria").character.energy, 93);
  assert.equal(world.getObservation("borin").character.energy, 94);
  const cooldown = world.getObservation("aria").nearby.find((item) => item.id === "borin").conversationAvailability;
  assert.equal(cooldown.blockingCode, "RECENT_CONVERSATION_COOLDOWN");
  assert.equal(cooldown.startEnergyCost, 3);
  assert.throws(
    () => world.startConversation("aria", "borin", "Too soon"),
    (error) => error instanceof DomainError && error.code === "RECENT_CONVERSATION_COOLDOWN",
  );

  clock.advanceGameMinutes(30);
  const fatigued = world.getObservation("aria").nearby.find((item) => item.id === "borin").conversationAvailability;
  assert.equal(fatigued.status, "available_with_pair_fatigue");
  assert.equal(fatigued.startEnergyCost, 3);
});

test("invitations target either a location or event and accepted commitments have outcomes", () => {
  const { world, clock } = dynamicWorld();
  world.createEvent({
    id: "debate", title: "Town debate", locationId: "square",
    startsAt: addGameMinutes(clock.now(), 90), endsAt: addGameMinutes(clock.now(), 150),
  });
  // The affordance declares that both destination kinds are open, rather than
  // enumerating every person against every place; the agent aims the invitation.
  const actions = world.getObservation("aria").availableActions.filter((action) => action.type === "send_invitation");
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].destinationTypes, ["location", "event"]);
  assert.ok(actions[0].openInvitationsRemaining > 0);

  // Both kinds are genuinely accepted by the server.
  const toEvent = world.sendInvitation("aria", "borin", {
    destinationType: "event", destinationId: "debate", message: "Come to the debate.",
  });
  assert.equal(toEvent.data.eventId, "debate");
  world.respondToInvitation("borin", toEvent.data.invitationId, "decline");

  const sent = world.sendInvitation("aria", "borin", {
    destinationType: "location", destinationId: "square", message: "Meet me at the square.",
  });
  assert.ok(world.getObservation("borin").availableActions.some((action) =>
    action.type === "respond_invitation" && action.invitationId === sent.data.invitationId));
  const commitment = world.respondToInvitation("borin", sent.data.invitationId, "accept");
  assert.equal(commitment.type, "COMMITMENT_CREATED");

  clock.advanceGameMinutes(30);
  world.advanceTo(clock.now());
  assert.equal(world.getPublicState().commitments[0].status, "kept");
  assert.equal(world.getRelationship("aria", "borin").trust, 4);
  assert.equal(world.getRelationship("borin", "aria").trust, 4);

  const eventInvitation = world.sendInvitation("aria", "borin", {
    destinationType: "event", destinationId: "debate", message: "Join me at the debate.",
  });
  assert.equal(eventInvitation.data.eventId, "debate");
  assert.equal(eventInvitation.data.locationId, "square");
});

test("two complementary residents can form, start, and split a team job", () => {
  const { world, clock } = dynamicWorld();
  world.bootstrapEconomy();
  world.createSystemJob({
    id: "joint-build", title: "Build a joint prototype", locationId: "square",
    durationGameMinutes: 20, compensation: 101,
    requirements: { creativity: 60, technical: 60 }, teamSize: 2,
  });

  const ariaAction = world.getObservation("aria").availableActions.find((action) =>
    action.type === "accept_job" && action.jobId === "joint-build");
  assert.equal(ariaAction.requirementsMode, "team_coverage");
  assert.equal(ariaAction.openTeamSlots, 2);
  // Being in availableActions at all is now the guarantee that it can be joined.
  world.acceptJob("aria", "joint-build");

  const borinAction = world.getObservation("borin").availableActions.find((action) =>
    action.type === "accept_job" && action.jobId === "joint-build");
  assert.equal(borinAction.openTeamSlots, 1);
  assert.deepEqual(borinAction.unmetRequirements, []);
  world.acceptJob("borin", "joint-build");
  world.startJob("aria", "joint-build");
  assert.equal(world.getObservation("aria").character.activity.jobId, "joint-build");
  assert.equal(world.getObservation("borin").character.activity.jobId, "joint-build");

  clock.advanceGameMinutes(20);
  world.advanceTo(clock.now());
  const job = world.getPublicState().jobs.find((item) => item.id === "joint-build");
  assert.equal(job.status, "completed");
  assert.deepEqual(job.workerIds, ["aria", "borin"]);
  assert.equal(world.getObservation("aria").character.credits, 51);
  assert.equal(world.getObservation("borin").character.credits, 50);
});

function dynamicWorld() {
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  let nextId = 1;
  const world = new World({
    store: new InMemoryEventStore(), config: makeConfig(), clock,
    idGenerator: () => `dynamic-${nextId++}`,
  });
  world.defineLocation({ id: "square", name: "Square" });
  world.defineLocation({ id: "workshop", name: "Workshop" });
  world.createCharacter({
    id: "aria", name: "Aria", locationId: "square",
    skills: { creativity: 80, technical: 10 },
  });
  world.createCharacter({
    id: "borin", name: "Borin", locationId: "square",
    skills: { creativity: 10, technical: 80 },
  });
  return { world, clock };
}

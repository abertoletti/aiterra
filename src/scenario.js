import { addGameMinutes, ManualClock } from "./domain/clock.js";
import { World } from "./domain/world.js";

export function bootstrapVerticalSlice({ store, config, gameNow, idGenerator }) {
  if (store.readAll().length > 0) return null;
  const start = addGameMinutes(gameNow, -360);
  const clock = new ManualClock(start);
  const world = new World({ store, config, clock, idGenerator });
  const result = runVerticalSlice(world, clock);
  clock.set(gameNow);
  world.advanceTo(gameNow);
  return result;
}

export function runVerticalSlice(world, clock) {
  const start = clock.now();
  const at = (minutes) => {
    clock.set(addGameMinutes(start, minutes));
    world.advanceTo(clock.now());
  };

  for (const [id, name] of [
    ["home", "Home"],
    ["cafe", "Café"],
    ["work-hub", "Work Hub"],
    ["training-center", "Training Center"],
    ["neon-club", "Neon Club"],
  ]) world.defineLocation({ id, name });

  world.createCharacter({
    id: "jack", name: "Jack", locationId: "home", credits: 200,
    personality: ["Ambitious", "Sociable", "Risk-taking", "Opportunistic"],
    goal: "Become one of the most influential characters in the city.",
    primaryGoal: { type: "strengthen_relationship", targetId: "sara", priority: "high", guidance: "Build a durable alliance with Sara." },
    skills: { social: 45, business: 25, creativity: 20, technical: 15 },
  });
  world.createCharacter({
    id: "sara", name: "Sara", locationId: "cafe", credits: 500,
    personality: ["Curious", "Perceptive", "Independent"],
    goal: "Build a trusted network and discover valuable opportunities.",
    primaryGoal: { type: "attend_event", targetId: "neon-friday", priority: "medium", guidance: "Meet useful people at public events." },
    skills: { social: 55, business: 30, creativity: 40, technical: 10 },
  });
  world.createCharacter({
    id: "luca", name: "Luca", locationId: "neon-club", credits: 1_000,
    personality: ["Competitive", "Persuasive", "Strategic"],
    goal: "Make Neon Club the center of the city's social life.",
    primaryGoal: { type: "find_work", targetId: "neon-club", priority: "medium", guidance: "Create activity around Neon Club." },
    skills: { social: 50, business: 60, creativity: 45, technical: 15 },
  });

  world.establishRelationship({ fromId: "jack", toId: "sara", value: 70, reason: "existing_friendship" });
  world.establishRelationship({ fromId: "sara", toId: "jack", value: 42, reason: "existing_friendship" });
  world.establishRelationship({ fromId: "jack", toId: "luca", value: -12, reason: "past_disagreement" });

  world.createEvent({
    creatorId: "luca", id: "neon-friday", title: "Neon Friday Party", locationId: "neon-club",
    startsAt: addGameMinutes(start, 55), endsAt: addGameMinutes(start, 180),
  });
  world.createJob({
    creatorId: "luca", id: "bartender-shift", title: "Bartender shift", locationId: "neon-club",
    durationGameMinutes: 180, compensation: 300, requirements: { social: 30 },
    availableFrom: start, availableUntil: addGameMinutes(start, 120),
  });
  at(5);
  world.startMove("jack", "neon-club");
  at(20);
  world.acceptJob("jack", "bartender-shift");
  world.startJob("jack", "bartender-shift");

  at(45);
  world.startMove("sara", "neon-club");
  at(60);
  world.attendEvent("sara", "neon-friday");

  at(63);
  const conversationStarted = world.startConversation("jack", "sara", "Hey, I didn't know you'd be here.");
  const conversationId = conversationStarted.data.conversationId;

  at(66);
  const revealingMessage = world.sendMessage("sara", conversationId,
    "Luca told me you're paid 500 credits for this shift. Is that true?",
    [{ id: "luca-jack-pay-claim", subjectId: "luca", claim: "Luca claimed that Jack earns 500 credits per shift." }]);
  const learnedEvent = [...world.history].reverse().find((event) =>
    event.type === "KNOWLEDGE_LEARNED" && event.data.characterId === "jack" && event.causedByEventIds.includes(revealingMessage.id));

  at(68);
  world.appraiseInteraction("jack", "sara", "appreciated", {
    conversationId,
    causedByEventIds: [revealingMessage.id],
  });

  at(70);
  world.sendMessage("jack", conversationId, "No. The offer is only 300. I need to ask Luca why he said that.");
  at(75);
  world.endConversation("jack", conversationId);

  at(200);
  at(210);
  const decision = world.recordDecision("jack", "Confront Luca about the contradictory pay claim before accepting another job from him.", [learnedEvent.id]);

  return {
    conversationId,
    revealingMessageEventId: revealingMessage.id,
    learnedEventId: learnedEvent.id,
    decisionEventId: decision.id,
  };
}

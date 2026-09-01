import assert from "node:assert/strict";
import test from "node:test";
import { World } from "../src/domain/world.js";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";
import { AgentSupervisor } from "../src/agents/agent-supervisor.js";
import { AgentDecisionPlanner, DecisionValidationError, buildDecisionMessages, validateAction } from "../src/agents/decision-planner.js";

function fixture() {
  const clock = new ManualClock("2042-01-01T10:00:00.000Z");
  const store = new InMemoryEventStore();
  const config = makeConfig();
  const world = new World({ clock, store, config, random: () => 0.5 });
  world.defineLocation({ id: "square", name: "Square" });
  world.defineLocation({ id: "other", name: "Other" });
  world.bootstrapEconomy();
  for (const id of ["a", "b"]) world.createCharacter({ id, name: id, locationId: "square", credits: 500 });
  const step = (minutes) => { clock.advanceGameMinutes(minutes); world.advanceTo(clock.now()); };
  return { world, clock, config, store, step };
}
const offer = (id = "shift") => ({ id, title: id, locationId: "square", durationGameMinutes: 10,
  compensation: 50, repeatable: true, cooldownGameMinutes: 10 });
const has = (world, id, type) => world.getObservation(id).availableActions.some((action) => action.type === type);
const rejects = (code, fn) => assert.throws(fn, (error) => error.code === code);
function event(world, clock) {
  world.createEvent({ id: "night", title: "Night", locationId: "square", startsAt: clock.now(),
    endsAt: new Date(clock.now().getTime() + 120 * 60_000), profile: { music: 80 } });
}

test("unfilled system slots refund once, recur across large advances, replay and never penalize workers", () => {
  const { world, clock, store, config, step } = fixture();
  world.createSystemJob(offer());
  step(121);
  assert.equal(world.requireJob("shift").terminalCause, "unfilled_system_slot");
  assert.equal(world.requireJob("shift").reservation.state, "refunded");
  step(10);
  assert.equal(world.requireJob("shift").status, "open");
  assert.ok(has(world, "a", "accept_job"));
  step(600);
  const job = world.requireJob("shift");
  assert.equal(job.status, "open");
  assert.ok(new Date(job.startGraceUntil) > clock.now());
  assert.equal(world.history.filter((entry) => entry.type === "REPUTATION_CHANGED").length, 0);
  const refunds = world.history.filter((entry) => entry.type === "JOB_ESCROW_REFUNDED");
  assert.equal(new Set(refunds.map((entry) => entry.data.reservationId)).size, refunds.length);
  const replay = new World({ clock, store, config });
  assert.deepEqual(replay.requireJob("shift"), job);
  const count = world.history.length;
  world.advanceTo(clock.now());
  assert.equal(world.history.length, count);
});

test("new slot policy does not expire or renew a resident-created offer at its start boundary", () => {
  const { world, step } = fixture();
  world.createJob({ ...offer(), creatorId: "a", repeatable: false });
  step(121);
  assert.equal(world.requireJob("shift").status, "open");
  assert.equal(world.history.filter((entry) => entry.type === "JOB_REOPENED").length, 0);
});

test("partially filled system teams expire without a no-show penalty and release commitments", () => {
  const { world, step } = fixture();
  world.createSystemJob({ ...offer(), teamSize: 2 });
  world.acceptJob("a", "shift");
  step(121);
  assert.equal(world.activeCommitmentFor("a"), undefined);
  assert.equal(world.requireJob("shift").terminalCause, "unfilled_system_slot");
  assert.equal(world.history.filter((entry) => entry.type === "REPUTATION_CHANGED").length, 0);
});

test("start_job affordance shares energy, team readiness, presence and time checks with command", () => {
  const { world, clock } = fixture();
  world.createSystemJob({ ...offer(), teamSize: 2 });
  world.acceptJob("a", "shift"); world.acceptJob("b", "shift");
  const peer = world.requireCharacter("b");
  const cases = [
    ["energy", 0, "INSUFFICIENT_ENERGY"],
    ["activity", { type: "rest" }, "ACTIVITY_CONFLICT"],
    ["locationId", "other", "TEAM_NOT_COLOCATED"],
    ["agentAvailability", "unavailable", "TEAM_MEMBER_UNAVAILABLE"],
  ];
  for (const [field, value, code] of cases) {
    const before = peer[field]; peer[field] = value;
    assert.equal(has(world, "a", "start_job"), false, code);
    assert.equal(world.jobStartFeasibility(world.requireCharacter("a"), world.requireJob("shift")).blockingCode, code);
    rejects(code, () => world.startJob("a", "shift"));
    peer[field] = before;
  }
  clock.advanceGameMinutes(121);
  assert.equal(has(world, "a", "start_job"), false);
  rejects("OUTSIDE_JOB_WINDOW", () => world.startJob("a", "shift"));
});

test("conversation menu excludes wrong-turn and energy-blocked messages and discloses topic enum", () => {
  const { world } = fixture();
  const started = world.startConversation("a", "b", "Hello");
  const id = started.data.conversationId;
  assert.equal(has(world, "a", "send_message"), false);
  rejects("OUT_OF_TURN", () => world.sendMessage("a", id, "Again"));
  const template = world.getObservation("b").availableActions.find((item) => item.type === "send_message");
  assert.ok(template.allowedTopics.includes("learning"));
  assert.ok(!template.allowedTopics.includes("technical"));
  world.requireCharacter("b").energy = 0;
  assert.equal(has(world, "b", "send_message"), false);
  rejects("INSUFFICIENT_ENERGY", () => world.sendMessage("b", id, "Hi"));
});

test("topic validation rejects wrong vocabulary and oversized or malformed arrays without truncation", () => {
  const observation = { availableActions: [{ type: "send_message", conversationId: "c", allowedTopics: ["learning", "music"] }] };
  const action = { type: "send_message", conversationId: "c", text: "Hello", topics: ["learning"] };
  assert.deepEqual(validateAction(action, observation).topics, ["learning"]);
  for (const topics of [["technical"], ["music", "music", "music"], "music"]) {
    assert.throws(() => validateAction({ ...action, topics }, observation), DecisionValidationError);
  }
});

test("attendance has entry and bounded checkpoints; stay survives replay without resolving or charging twice", () => {
  const { world, clock, store, config, step } = fixture(); event(world, clock);
  world.joinExperience("a", "night", { expectedHappiness: 10 });
  assert.equal(world.getDecisionRequirement("a").requiredNow, true);
  const observation = world.getObservation("a");
  const action = validateAction({ type: "stay_experience", eventId: "night" }, observation);
  world.executeAgentAction("a", action);
  assert.equal(world.getDecisionRequirement("a").requiredNow, false);
  step(29);
  assert.equal(world.getDecisionRequirement("a").requiredNow, false);
  step(1);
  assert.equal(world.getDecisionRequirement("a").requiredNow, true);
  const replay = new World({ clock, store, config });
  assert.deepEqual(replay.getDecisionRequirement("a"), world.getDecisionRequirement("a"));
  world.stayExperience("a", "night");
  assert.equal(world.history.filter((entry) => entry.type === "EXPERIENCE_HAPPINESS_RESOLVED").length, 0);
  assert.equal(world.history.filter((entry) => entry.type === "EVENT_ATTENDANCE_STARTED").length, 1);
  world.leaveExperience("a", "night");
  rejects("NOT_ATTENDING", () => world.stayExperience("a", "night"));
});

test("own raw expectation/outcome feedback is persistent, private and reaches the model", () => {
  const { world, clock, store, config, step } = fixture(); event(world, clock);
  world.joinExperience("a", "night", { expectedHappiness: 10 }); step(120);
  const observation = world.getObservation("a");
  const resolved = world.history.find((entry) => entry.type === "EXPERIENCE_HAPPINESS_RESOLVED");
  assert.equal(observation.recentHappiness[0].realizedHappiness, resolved.data.rawDelta);
  assert.equal(observation.recentHappiness[0].expectedHappiness, 10);
  assert.deepEqual(world.getObservation("b").recentHappiness, []);
  assert.deepEqual(new World({ clock, store, config }).getObservation("a").recentHappiness, observation.recentHappiness);
  const payload = JSON.parse(buildDecisionMessages(observation)[1].content);
  assert.deepEqual(payload.recentHappiness, observation.recentHappiness);
  assert.deepEqual(payload.known, observation.known);
});

test("goal sources survive history truncation through authoritative active-goal references; duplicates remain invalid", () => {
  const { world, clock, step } = fixture(); event(world, clock);
  world.joinExperience("a", "night"); step(120);
  const source = world.history.find((entry) => entry.type === "EXPERIENCE_HAPPINESS_RESOLVED");
  world.proposeSecondaryGoal("a", { type: "pursue_goal", sourceEventId: source.id, declaredReason: "Save for a room" });
  const obs = world.getObservation("a");
  assert.ok(obs.goalSourceEventIds.includes(source.id));
  const candidate = { type: "propose_secondary_goal", goal: { type: "visit_location", targetId: "other", sourceEventId: source.id, declaredReason: "Explore" } };
  assert.equal(validateAction(candidate, obs, []).goal.sourceEventId, source.id);
  assert.throws(() => validateAction({ ...candidate, goal: { ...candidate.goal, type: "pursue_goal", targetId: null } }, obs, []), /already active/);
  assert.throws(() => validateAction({ ...candidate, goal: { ...candidate.goal, sourceEventId: "hidden" } }, obs, []), /not visible/);
});

test("local validation failures get one feedback repair, then no paid inference until actionable state changes", async () => {
  let calls = 0;
  let version = 1;
  const obs = { character: { id: "a" }, availableActions: [{ type: "rest" }], decision: { requiredNow: true, reason: "idle" }, pendingNotifications: [] };
  const messages = [];
  const planner = new AgentDecisionPlanner({ modelClient: { async complete({ messages: prompt }) {
    calls += 1; messages.push(JSON.parse(prompt[1].content));
    return { content: JSON.stringify({ action: { type: "accept_job", jobId: "invented" } }) };
  } } });
  const agent = { characterId: "a", client: {
    async observe() { return { ...obs, stateVersion: version++, worldTime: new Date().toISOString() }; },
    async history() { return []; },
    async submitAction() { assert.fail("invalid actions must not be submitted"); },
  } };
  const supervisor = new AgentSupervisor({ agents: [agent], planner, logger: {}, maximumActionsPerCycle: 3 });
  supervisor.running = true;
  const state = supervisor.states.get("a");
  await supervisor.runDecisionCycle(agent, state);
  assert.equal(calls, 2);
  assert.equal(messages[1].recentActionFailures[0].stage, "local_validation");
  assert.equal(messages[1].recentActionFailures[0].action.jobId, "invented");
  await supervisor.runDecisionCycle(agent, state);
  assert.equal(calls, 2, "world time and version alone must not trigger another paid inference");
  obs.availableActions.push({ type: "move", destinationId: "other" });
  await supervisor.runDecisionCycle(agent, state);
  assert.equal(calls, 4);
});

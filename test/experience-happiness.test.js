import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";

const DIMENSIONS = [
  "music", "socializing", "learning", "competition", "spirituality",
  "luxury", "adventure", "relaxation", "creativity", "nature",
];

// random is injected so variance is deterministic: 0.5 draws exactly 0, which lets the
// other factors be asserted exactly. A separate test covers variance itself.
function experienceWorld({ random = () => 0.5, preferences = null, credits = 500 } = {}) {
  const clock = new ManualClock("2042-03-01T20:00:00.000Z");
  const world = new World({ store: new InMemoryEventStore(), config: makeConfig(), clock, random });
  world.defineLocation({ id: "club", name: "The Hole" });
  world.defineLocation({ id: "garden", name: "The Silent Garden" });
  world.bootstrapEconomy();
  world.createCharacter({
    id: "jack", name: "Jack", locationId: "club", credits,
    personality: ["Ambitious"], goal: "Be known.",
    // A resident who cares about music and nightlife and not about quiet.
    preferences: preferences ?? {
      music: 90, socializing: 80, learning: 20, competition: 60, spirituality: 10,
      luxury: 70, adventure: 80, relaxation: 30, creativity: 60, nature: 0,
    },
  });
  return { world, clock };
}

function nightAtTheClub(world, clock, overrides = {}) {
  return world.createEvent({
    id: overrides.id ?? "friday-night",
    title: overrides.title ?? "Friday night",
    locationId: overrides.locationId ?? "club",
    startsAt: clock.now(),
    endsAt: new Date(clock.now().getTime() + 120 * 60_000),
    profile: overrides.profile ?? { music: 90, socializing: 80, luxury: 20 },
    accessPrice: overrides.accessPrice ?? 0,
    capacity: overrides.capacity ?? null,
  });
}

test("preferences are budgeted and profiles are not", () => {
  const { world } = experienceWorld();
  const jack = world.getObservation("jack").character;

  assert.equal(Object.keys(jack.preferences).length, 10);
  assert.equal(Object.values(jack.preferences).reduce((a, b) => a + b, 0), 500,
    "caring is the scarce resource, so preferences meet a fixed budget");

  // A default character gets an even spread rather than nothing.
  world.createCharacter({ id: "plain", name: "Plain", locationId: "club", personality: [], goal: "Exist." });
  assert.deepEqual(world.getObservation("plain").character.preferences,
    Object.fromEntries(DIMENSIONS.map((d) => [d, 50])));

  const rejects = (code, run) => assert.throws(run,
    (error) => error instanceof DomainError && error.code === code, `expected ${code}`);
  rejects("INVALID_PROFILE_BUDGET", () => world.createCharacter({
    id: "greedy", name: "Greedy", locationId: "club", personality: [], goal: "Want all.",
    preferences: Object.fromEntries(DIMENSIONS.map((d) => [d, 100])),
  }));
  rejects("UNKNOWN_PROFILE_DIMENSION", () => world.createCharacter({
    id: "invented", name: "Invented", locationId: "club", personality: [], goal: "x",
    preferences: { nightlife: 500 },
  }));

  // An experience profile has no budget: it may deliver a lot, or a little.
  const rich = world.createEvent({
    id: "rich", title: "A rich evening", locationId: "club",
    startsAt: "2042-03-02T20:00:00.000Z", endsAt: "2042-03-02T23:00:00.000Z",
    profile: { music: 90, socializing: 90, luxury: 90, adventure: 90 },
  });
  assert.equal(rich.data.profile.music, 90, "a rich evening need not describe itself as a thin one");
  rejects("EMPTY_EXPERIENCE_PROFILE", () => world.createEvent({
    id: "empty", title: "Nothing at all", locationId: "club",
    startsAt: "2042-03-02T20:00:00.000Z", endsAt: "2042-03-02T21:00:00.000Z",
    profile: Object.fromEntries(DIMENSIONS.map((d) => [d, 0])),
  }));
});

test("affinity weights preferences by what the experience actually delivers", () => {
  const { world, clock } = experienceWorld();
  // Jack cares about music (90) and not about spirituality (10).
  const loud = nightAtTheClub(world, clock, { id: "loud", profile: { music: 100 } });
  const quiet = nightAtTheClub(world, clock, { id: "quiet", locationId: "garden", profile: { spirituality: 100 } });
  assert.ok(loud && quiet);

  const affinityOf = (eventId) => {
    const gathering = world.getPublicState().events.find((item) => item.id === eventId);
    return gathering;
  };
  assert.ok(affinityOf("loud"), "the event is published");

  // A music-only evening is measured purely against how much Jack cares about music,
  // and a spirituality-only evening purely against spirituality.
  world.joinExperience("jack", "loud");
  clock.advanceGameMinutes(120);
  world.advanceTo(clock.now());
  const loudResolution = world.history.find((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED");
  assert.equal(loudResolution.data.factors.affinityValue, 90, "delivered music only, so affinity is the music preference");
});

test("a resolution's factors sum to its raw delta", () => {
  const { world, clock } = experienceWorld();
  nightAtTheClub(world, clock);
  world.joinExperience("jack", "friday-night");
  clock.advanceGameMinutes(120);
  world.advanceTo(clock.now());

  const resolution = world.history.find((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED");
  const f = resolution.data.factors;
  const summed = f.affinity + f.socialValue + f.participation + f.interaction + f.crowd + f.repetition + f.variance;
  assert.ok(Math.abs(summed - resolution.data.rawDelta) < 0.02,
    `the breakdown must explain the delta: ${summed} vs ${resolution.data.rawDelta}`);
  // An owner reading the feed can see every cause, variance included.
  for (const key of ["affinity", "socialValue", "participation", "interaction", "crowd", "repetition", "variance"]) {
    assert.equal(typeof f[key], "number", `${key} must be recorded`);
  }
});

test("variance is drawn once, recorded, and never redrawn on replay", () => {
  const draws = [0.9, 0.1];
  let index = 0;
  const { world, clock } = experienceWorld({ random: () => draws[index++] ?? 0.5 });
  nightAtTheClub(world, clock);
  world.joinExperience("jack", "friday-night");
  clock.advanceGameMinutes(120);
  world.advanceTo(clock.now());

  const resolution = world.history.find((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED");
  assert.equal(resolution.data.factors.variance, 1.2, "0.9 of the range draws +1.2 of a 1.5 bound");
  assert.equal(index, 1, "variance is drawn exactly once per resolution");

  // Replaying the same history with a different generator must produce the same world.
  const replayed = new World({
    store: new InMemoryEventStore(world.history), config: makeConfig(),
    clock: new ManualClock(clock.now()), random: () => 0.0,
  });
  assert.equal(replayed.getObservation("jack").character.happiness,
    world.getObservation("jack").character.happiness,
    "a replay reads the recorded draw rather than making a new one");
});

test("paid admission is atomic: it charges and admits, or does neither", () => {
  const { world, clock } = experienceWorld({ credits: 60 });
  nightAtTheClub(world, clock, { accessPrice: 50 });
  const budgetBefore = world.getPublicState().economy.systemBudgets.find((b) => b.id === "world-bootstrap").balance;

  world.joinExperience("jack", "friday-night");
  assert.equal(world.getObservation("jack").character.credits, 10, "the price is debited");
  assert.equal(world.getPublicState().economy.systemBudgets.find((b) => b.id === "world-bootstrap").balance,
    budgetBefore + 50, "and credited to the configured destination, so supply stays auditable");
  assert.equal(world.getObservation("jack").character.activity.eventId, "friday-night");

  // A second, unaffordable experience charges nothing and admits nobody.
  clock.advanceGameMinutes(130);
  world.advanceTo(clock.now());
  world.createEvent({
    id: "expensive", title: "Members only", locationId: "club",
    startsAt: clock.now(), endsAt: new Date(clock.now().getTime() + 60 * 60_000),
    profile: { luxury: 100 }, accessPrice: 200,
  });
  const creditsBefore = world.getObservation("jack").character.credits;
  assert.throws(() => world.joinExperience("jack", "expensive"),
    (error) => error instanceof DomainError && error.code === "INSUFFICIENT_CREDITS");
  assert.equal(world.getObservation("jack").character.credits, creditsBefore, "a refused entry charges nothing");
  assert.equal(world.getObservation("jack").character.activity, null, "and admits nobody");
});

test("attendance charges entry once and duration once, and leaving triggers settlement", () => {
  const { world, clock } = experienceWorld();
  nightAtTheClub(world, clock);
  const energyBefore = world.getObservation("jack").character.energy;

  world.joinExperience("jack", "friday-night");
  assert.equal(world.getObservation("jack").character.energy, energyBefore - 3, "entry costs the participation cost");

  clock.advanceGameMinutes(90);
  world.leaveExperience("jack", "friday-night");
  const reasons = world.history.filter((event) => event.type === "ENERGY_CHANGED"
    && event.data.characterId === "jack").map((event) => event.data.reason);
  assert.deepEqual(reasons, ["experience_entry", "experience_duration"], "each charged exactly once");
  assert.equal(world.getObservation("jack").character.energy, energyBefore - 3 - 3,
    "90 minutes present costs 3 marginal energy at 1 per 30");
  assert.equal(world.getObservation("jack").character.activity, null);
});

test("an experience resolves exactly once, whether the resident leaves or it ends", () => {
  const { world, clock } = experienceWorld();
  nightAtTheClub(world, clock);
  world.joinExperience("jack", "friday-night");
  clock.advanceGameMinutes(30);
  world.leaveExperience("jack", "friday-night");

  // The event's own end passes afterwards and must not resolve a second time.
  clock.advanceGameMinutes(120);
  world.advanceTo(clock.now());
  assert.equal(world.history.filter((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED").length, 1);

  assert.throws(() => world.leaveExperience("jack", "friday-night"),
    (error) => error instanceof DomainError && error.code === "NOT_ATTENDING");
});

test("leaving early is worse than staying, and the resident still paid", () => {
  const brief = experienceWorld({ credits: 100 });
  nightAtTheClub(brief.world, brief.clock, { accessPrice: 20 });
  brief.world.joinExperience("jack", "friday-night");
  brief.clock.advanceGameMinutes(5);
  brief.world.leaveExperience("jack", "friday-night");

  const full = experienceWorld({ credits: 100 });
  nightAtTheClub(full.world, full.clock, { accessPrice: 20 });
  full.world.joinExperience("jack", "friday-night");
  full.clock.advanceGameMinutes(120);
  full.world.advanceTo(full.clock.now());

  const factorsOf = (world) => world.history.find((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED").data.factors;
  assert.equal(factorsOf(brief.world).participation, -4, "5 minutes of a 2-hour evening is a bad evening");
  assert.equal(factorsOf(full.world).participation, 2);
  assert.ok(brief.world.getObservation("jack").character.happiness
    < full.world.getObservation("jack").character.happiness);
  assert.equal(brief.world.getObservation("jack").character.credits, 80,
    "and the admission is not refunded, which is what makes the negative factor bite");
});

test("happiness saturates toward the bounds", () => {
  const { world } = experienceWorld();
  // A large raw gain applies fully in the middle of the range and barely at the top.
  const first = world.changeHappiness("jack", 15, "test");
  assert.equal(first.data.previous, 50);
  assert.equal(first.data.value, 58, "15 raw at 50 applies as 8");

  for (let i = 0; i < 20; i += 1) world.changeHappiness("jack", 15, "test");
  const happiness = world.getObservation("jack").character.happiness;
  assert.ok(happiness > 90 && happiness < 100, `saturating, not pinned: ${happiness}`);
});

test("repeating the same venue makes the evening worse", () => {
  const { world, clock } = experienceWorld();
  const factors = [];
  for (let night = 1; night <= 3; night += 1) {
    world.createEvent({
      id: `night-${night}`, title: `Night ${night}`, locationId: "club",
      startsAt: clock.now(), endsAt: new Date(clock.now().getTime() + 120 * 60_000),
      profile: { music: 90, socializing: 80 },
    });
    world.joinExperience("jack", `night-${night}`);
    clock.advanceGameMinutes(121);
    world.advanceTo(clock.now());
    factors.push(world.history.filter((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED").at(-1).data.factors);
  }

  assert.equal(factors[0].repetition, 0, "the first visit is not a repeat");
  assert.equal(factors[1].repetition, -1.5);
  assert.equal(factors[2].repetition, -3);
  assert.ok(factors[2].affinity === factors[0].affinity, "the venue did not change, only the repetition");
});

test("neglect decays happiness, and working costs it too", () => {
  const { world, clock } = experienceWorld();
  // A resident who never gathers drifts down, one world day at a time.
  clock.advanceGameMinutes(1440 * 3);
  world.advanceTo(clock.now());
  const decayed = world.history.filter((event) => event.type === "HAPPINESS_DECAYED");
  assert.ok(decayed.length >= 1, "neglect is applied by the world, not by the agent");
  assert.equal(world.getObservation("jack").character.happiness, 47, "three world days without an experience");

  // Working pays Credits and costs Happiness, so the tension is real.
  world.createSystemJob({
    id: "shift", title: "A shift", locationId: "club",
    durationGameMinutes: 20, compensation: 40,
  });
  world.acceptJob("jack", "shift");
  world.startJob("jack", "shift");
  const before = world.getObservation("jack").character.happiness;
  clock.advanceGameMinutes(21);
  world.advanceTo(clock.now());

  const jack = world.getObservation("jack").character;
  assert.ok(jack.credits > 500, "the shift paid");
  assert.ok(jack.happiness < before, "and cost happiness");
  assert.ok(world.history.some((event) => event.type === "HAPPINESS_CHANGED"
    && event.data.reason === "work_completed"), "recorded with its cause");
});

test("a character sees its own happiness and never another's", () => {
  const { world } = experienceWorld();
  world.createCharacter({
    id: "sara", name: "Sara", locationId: "club", personality: [], goal: "Watch.",
    preferences: { music: 50, socializing: 50, learning: 50, competition: 50, spirituality: 50, luxury: 50, adventure: 50, relaxation: 50, creativity: 50, nature: 50 },
  });
  const observation = world.getObservation("jack");

  assert.equal(typeof observation.character.happiness, "number");
  assert.ok(observation.character.preferences.music > 0);
  const sara = observation.nearby.find((person) => person.id === "sara");
  assert.ok(sara, "Sara is visible as a person");
  assert.equal(sara.happiness, undefined, "but her happiness is not");
  assert.equal(sara.preferences, undefined, "and neither are her preferences");
});

test("the rules manifest tells a stateless model what moves happiness", () => {
  const { world } = experienceWorld();
  const manifest = world.getAgentRules("jack");

  assert.equal(manifest.happiness.policyVersion, 1);
  assert.deepEqual(manifest.happiness.range, [0, 100]);
  assert.deepEqual(manifest.happiness.profileDimensions, DIMENSIONS);
  for (const field of ["instruction", "experienceValue", "pursuit", "neglect", "privacy"]) {
    assert.ok(manifest.happiness[field].length > 0, `happiness.${field} must say something`);
  }
});

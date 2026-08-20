import assert from "node:assert/strict";
import test from "node:test";
import { ManualClock } from "../src/domain/clock.js";
import { makeConfig } from "../src/domain/config.js";
import { DomainError, World } from "../src/domain/world.js";
import { InMemoryEventStore } from "../src/infra/event-store.js";
import { byEvent, offered } from "./support/observation.js";

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
  const summed = f.affinity + f.presenceValue + f.interaction + f.participation + f.crowd + f.repetition + f.variance;
  assert.ok(Math.abs(summed - resolution.data.rawDelta) < 0.02,
    `the breakdown must explain the delta: ${summed} vs ${resolution.data.rawDelta}`);
  // An owner reading the feed can see every cause, variance included.
  for (const key of ["affinity", "presenceValue", "interaction", "participation", "crowd", "repetition", "variance"]) {
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

test("happiness is a bounded state and an unbounded lived total", () => {
  const { world, clock } = experienceWorld();
  const jack = () => world.getObservation("jack").character;
  assert.equal(jack().livedHappiness, 0, "a new resident has lived nothing yet");

  // Push the state near its ceiling, then live one more good evening.
  for (let i = 0; i < 25; i += 1) world.changeHappiness("jack", 15, "test");
  const stateBefore = jack().happiness;
  const livedBefore = jack().livedHappiness;
  assert.ok(stateBefore > 90, `expected a nearly-happy resident, got ${stateBefore}`);

  world.changeHappiness("jack", 15, "test");
  const stateGain = jack().happiness - stateBefore;
  const livedGain = jack().livedHappiness - livedBefore;
  assert.ok(stateGain <= 2, `the state saturates near the ceiling: gained ${stateGain}`);
  assert.equal(livedGain, 15, "but the whole of what was lived counts toward the total");
  assert.ok(jack().livedHappiness > 100, "the lived total is unbounded, so a run can be won on it");
});

test("neglect lowers the state without subtracting from what was lived", () => {
  const { world, clock } = experienceWorld();
  world.changeHappiness("jack", 10, "test");
  const livedBefore = world.getObservation("jack").character.livedHappiness;
  const stateBefore = world.getObservation("jack").character.happiness;

  clock.advanceGameMinutes(1440 * 2);
  world.advanceTo(clock.now());

  const jack = world.getObservation("jack").character;
  assert.ok(jack.happiness < stateBefore, "the state decays");
  assert.equal(jack.livedHappiness, livedBefore,
    "decay is the absence of experience, not an experience, so nothing lived is taken away");
});

test("who you talked to, how it went, and what about, all change the evening", () => {
  // Four otherwise identical evenings that differ only in the interaction.
  const evening = ({ speak = 0, appraisal = null, topics = [], stranger = false } = {}) => {
    const { world, clock } = experienceWorld();
    world.createCharacter({
      id: "sara", name: "Sara", locationId: "club", personality: [], goal: "Be here.",
      preferences: Object.fromEntries(DIMENSIONS.map((d) => [d, 50])),
    });
    if (!stranger) {
      // Someone Jack cares about a great deal.
      world.establishRelationship({ fromId: "jack", toId: "sara", affinity: 80, trust: 40 });
      world.establishRelationship({ fromId: "sara", toId: "jack", affinity: 60 });
    }
    nightAtTheClub(world, clock);
    world.joinExperience("jack", "friday-night");
    world.joinExperience("sara", "friday-night");
    if (speak > 0) {
      const conversation = world.startConversation("jack", "sara", "Good to see you.", [], { topics });
      for (let turn = 1; turn < speak; turn += 1) {
        world.sendMessage(turn % 2 === 1 ? "sara" : "jack", conversation.data.conversationId, `Turn ${turn}`, [], { topics });
      }
      if (appraisal) {
        world.appraiseInteraction("jack", "sara", appraisal.value,
          { conversationId: conversation.data.conversationId, interactionKind: appraisal.kind });
      }
    }
    clock.advanceGameMinutes(121);
    world.advanceTo(clock.now());
    return world.history.filter((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED"
      && event.data.characterId === "jack").at(-1).data.factors;
  };

  const alone = evening();
  const present = evening({ speak: 0 });
  const talkedWell = evening({ speak: 4, appraisal: { kind: "interaction", value: "appreciated" } });
  const argued = evening({ speak: 4, appraisal: { kind: "insult", value: "offended" } });
  const withStranger = evening({ speak: 4, appraisal: { kind: "interaction", value: "appreciated" }, stranger: true });

  // Presence with someone valued is worth something, but much less than talking.
  assert.ok(present.presenceValue > 0, "being in the room with someone you value counts");
  assert.ok(talkedWell.interaction > present.presenceValue * 2,
    "and talking to them counts far more, which is what stops presence-farming");

  // The sign matters: an argument with someone who matters makes the evening worse.
  assert.ok(argued.interaction < 0, `an argument must cost, got ${argued.interaction}`);
  assert.ok(argued.interaction < talkedWell.interaction);

  // A good exchange with a stranger is worth less than with someone who matters,
  // but not nothing, because meeting people has to be worthwhile.
  assert.ok(withStranger.interaction > 0);
  assert.ok(withStranger.interaction < talkedWell.interaction,
    "relationship importance weighs the same conversation differently");

  assert.equal(alone.interaction, 0, "no interaction, no interaction value");
});

test("talking about what the other person cares about lands better", () => {
  const factorsWith = (topics) => {
    const { world, clock } = experienceWorld();
    world.createCharacter({
      id: "sara", name: "Sara", locationId: "club", personality: [], goal: "Be here.",
      // Sara cares about music and not at all about competition.
      preferences: {
        music: 100, socializing: 100, learning: 60, competition: 0, spirituality: 60,
        luxury: 60, adventure: 40, relaxation: 40, creativity: 40, nature: 0,
      },
    });
    world.establishRelationship({ fromId: "sara", toId: "jack", affinity: 60 });
    nightAtTheClub(world, clock);
    world.joinExperience("sara", "friday-night");
    world.joinExperience("jack", "friday-night");
    const conversation = world.startConversation("sara", "jack", "Listen to this.", [], { topics });
    world.sendMessage("jack", conversation.data.conversationId, "Go on.", [], { topics });
    clock.advanceGameMinutes(121);
    world.advanceTo(clock.now());
    return world.history.filter((event) => event.type === "EXPERIENCE_HAPPINESS_RESOLVED"
      && event.data.characterId === "sara").at(-1).data.factors;
  };

  const aboutMusic = factorsWith(["music"]);
  const aboutCompetition = factorsWith(["competition"]);
  const aboutNothing = factorsWith([]);

  assert.ok(aboutMusic.interaction > aboutNothing.interaction,
    "a conversation about what she cares about is worth more than an undeclared one");
  assert.ok(aboutCompetition.interaction < aboutNothing.interaction,
    "and one about something she does not care about is worth less");
  assert.deepEqual(aboutMusic.interactionDetail[0].topics, ["music"],
    "the topic is recorded, so the evening stays explainable");
});

test("an invented conversation topic is rejected, not ignored", () => {
  const { world, clock } = experienceWorld();
  world.createCharacter({ id: "sara", name: "Sara", locationId: "club", personality: [], goal: "x" });
  nightAtTheClub(world, clock);

  assert.throws(
    () => world.startConversation("jack", "sara", "Hello", [], { topics: ["nightlife"] }),
    (error) => error instanceof DomainError && error.code === "UNKNOWN_TOPIC",
  );
  assert.throws(
    () => world.startConversation("jack", "sara", "Hello", [], { topics: ["music", "luxury", "nature"] }),
    (error) => error instanceof DomainError && error.code === "TOO_MANY_TOPICS",
  );
});

// One feasibility computation feeds the affordance, the catalog, and the command, so an
// agent can never be told an evening is possible and then refused it.
// The observation separates the menu from the map, so an offer is now a pair: the notice
// itself, and whether it can be acted on right now.
function attendanceOffer(world, characterId, eventId) {
  return offered(world.getObservation(characterId), byEvent("attend_event", eventId));
}

test("an unaffordable experience is disclosed as unaffordable, not discovered on rejection", () => {
  const { world, clock } = experienceWorld({ credits: 10 });
  nightAtTheClub(world, clock, { id: "members-only", title: "Members only", accessPrice: 200 });

  const offer = attendanceOffer(world, "jack", "members-only");
  assert.equal(offer.orderable, false,
    "an evening Jack cannot pay for must not sit among the things he can do");
  assert.ok(offer.entry.blockedBy.includes("INSUFFICIENT_CREDITS"),
    "and the reason has to be the actual one");
  assert.equal(offer.entry.accessPrice, 200, "with the price still stated in full");

  assert.throws(() => world.joinExperience("jack", "members-only"),
    (error) => error instanceof DomainError && error.code === "INSUFFICIENT_CREDITS",
    "the command refuses with exactly the code the affordance disclosed");
});

test("a full experience is disclosed as full, and opens up again when someone leaves", () => {
  const { world, clock } = experienceWorld();
  world.createCharacter({ id: "sara", name: "Sara", locationId: "club", personality: [], goal: "Dance." });
  nightAtTheClub(world, clock, { capacity: 1 });
  world.joinExperience("sara", "friday-night");

  const full = attendanceOffer(world, "jack", "friday-night");
  assert.equal(full.orderable, false);
  assert.ok(full.entry.blockedBy.includes("EXPERIENCE_FULL"));
  assert.equal(full.entry.attendeeCount, 1);
  assert.throws(() => world.joinExperience("jack", "friday-night"),
    (error) => error instanceof DomainError && error.code === "EXPERIENCE_FULL");

  // Capacity counts who is present, not everyone who ever entered, so a room that
  // emptied is open again rather than permanently full.
  world.leaveExperience("sara", "friday-night");
  const reopened = attendanceOffer(world, "jack", "friday-night");
  assert.equal(reopened.entry.attendeeCount, 0, "the departed attendee no longer occupies a place");
  assert.equal(reopened.orderable, true);
  assert.equal(world.joinExperience("jack", "friday-night").data.characterId, "jack",
    "and the command agrees that it is now possible");
});

test("the experiences catalog reports what feasibleOnly removed", () => {
  const { world, clock } = experienceWorld({ credits: 10 });
  world.createCharacter({ id: "sara", name: "Sara", locationId: "club", personality: [], goal: "Dance." });
  nightAtTheClub(world, clock, { id: "open-night", title: "Open night" });
  nightAtTheClub(world, clock, { id: "members-only", title: "Members only", accessPrice: 200 });
  nightAtTheClub(world, clock, { id: "one-in", title: "One in", capacity: 1 });
  world.joinExperience("sara", "one-in");

  const everything = world.inspectContext("jack", { resource: "experiences", limit: 50 });
  assert.equal(everything.count, 3, "a catalog returns blocked items too");
  assert.equal(everything.feasibleCount, 1);
  assert.equal(everything.blockedCount, 2);
  assert.equal(everything.blockedOmitted, 0, "nothing was removed, because nothing was filtered");

  const codesFor = (id) => everything.items.find((item) => item.id === id).feasibility.blockingCodes;
  assert.ok(codesFor("members-only").includes("INSUFFICIENT_CREDITS"));
  assert.ok(codesFor("one-in").includes("EXPERIENCE_FULL"));
  assert.equal(everything.items.find((item) => item.id === "one-in").attendeeCount, 1);

  const feasible = world.inspectContext("jack", {
    resource: "experiences", limit: 50, filters: { feasibleOnly: true },
  });
  assert.deepEqual(feasible.items.map((item) => item.id), ["open-night"]);
  assert.equal(feasible.blockedOmitted, 2,
    "a short list has to be distinguishable from a quiet world");
});

test("the run report measures what the evening was worth, per factor and per resident", () => {
  const { world, clock } = experienceWorld({ credits: 100 });
  world.createCharacter({ id: "sara", name: "Sara", locationId: "club", credits: 100, personality: [], goal: "Dance." });
  nightAtTheClub(world, clock, { accessPrice: 20 });
  world.joinExperience("jack", "friday-night");
  world.joinExperience("sara", "friday-night");
  clock.advanceGameMinutes(100);
  world.leaveExperience("jack", "friday-night");

  const experiences = world.getProductMetrics({ environment: "test", isTest: true, testRunId: "happiness-1" }).experiences;

  assert.equal(experiences.attendances, 2);
  assert.equal(experiences.resolutions, 1, "Sara has not left yet, so her evening is unresolved");
  assert.equal(experiences.paidAttendances, 2);
  assert.equal(experiences.creditsSpentOnAccess, 40, "Credits leaving circulation is the sink the pilot lacked");
  assert.equal(typeof experiences.meanRealizedDelta, "number");

  // Without a per-factor mean there is no way to tell a factor that is doing work from
  // one that is dead weight, which is exactly what the open calibration needs.
  assert.deepEqual(Object.keys(experiences.meanFactorContribution).sort(),
    ["affinity", "crowd", "interaction", "participation", "presenceValue", "repetition", "variance"],
    "only the factors that sum to the delta are contributions; the diagnostics beside them are not");
  assert.ok(!("profileTaxonomyVersion" in experiences.meanFactorContribution),
    "averaging a version number as a Happiness contribution is meaningless");
  assert.ok(!("presenceMinutes" in experiences.meanFactorContribution));

  const jack = experiences.happinessByCharacter.find((row) => row.characterId === "jack");
  assert.equal(typeof jack.happiness, "number");
  assert.equal(typeof jack.livedHappiness, "number");
  assert.ok(experiences.happinessByCharacter.every((row) => row.livedHappiness !== undefined),
    "a resident who never went anywhere still reports a lived total of zero");
});

function gardenNight(world, clock, overrides = {}) {
  return world.createEvent({
    id: overrides.id ?? "midnight-garden",
    title: overrides.title ?? "Midnight meditation under synthetic trees",
    locationId: "garden",
    startsAt: clock.now(),
    endsAt: new Date(clock.now().getTime() + 120 * 60_000),
    profile: overrides.profile ?? { relaxation: 90, spirituality: 80, nature: 70 },
    accessPrice: overrides.accessPrice ?? 15,
    capacity: overrides.capacity ?? 4,
  });
}

test("every public experience in the city is discoverable, with what it delivers and costs", () => {
  const { world, clock } = experienceWorld({ credits: 500 });
  nightAtTheClub(world, clock);
  gardenNight(world, clock);

  // Jack is at the club and has never been to the garden, never been invited, and knows
  // nobody there. The garden is still his to find, or nobody would build one.
  const catalog = world.inspectContext("jack", { resource: "experiences", limit: 50 });
  assert.deepEqual(catalog.items.map((item) => item.id), ["friday-night", "midnight-garden"]);

  const garden = catalog.items.find((item) => item.id === "midnight-garden");
  assert.equal(garden.accessPrice, 15, "the price is known before travelling there");
  assert.equal(garden.capacity, 4);
  assert.equal(garden.profile.relaxation, 90, "and what the evening actually delivers");
  assert.equal(garden.profile.music, 0, "an unmentioned dimension is zero, not absent");
  assert.deepEqual(garden.tags, ["nature", "relaxation", "spirituality"],
    "tags are derived from the profile, so they cannot claim what it does not deliver");
  assert.equal(garden.attendanceEnergyCost, 3);
  assert.deepEqual(garden.repetition, { priorSimilarAttendances: 0, windowWorldDays: 7, factor: 0 },
    "repetition is private history, so it has to be disclosed or the penalty is a surprise");
});

test("a resident can narrow the city to what it cares about, and is told what was left out", () => {
  const { world, clock } = experienceWorld({ credits: 500 });
  nightAtTheClub(world, clock);
  gardenNight(world, clock);
  const ask = (filters) => world.inspectContext("jack", { resource: "experiences", limit: 50, filters });

  // Jack cares about music and not about quiet, and the catalog lets him say so.
  const loud = ask({ tag: "music" });
  assert.deepEqual(loud.items.map((item) => item.id), ["friday-night"]);
  assert.equal(loud.filteredOmitted, 1, "a short list is distinguishable from a quiet city");
  assert.equal(loud.knownCount, 2);

  const quiet = ask({ tag: "nature" });
  assert.deepEqual(quiet.items.map((item) => item.id), ["midnight-garden"]);

  const congenial = ask({ minimumAffinity: 70 });
  assert.deepEqual(congenial.items.map((item) => item.id), ["friday-night"]);
  assert.equal(congenial.filteredOmitted, 1);

  const free = ask({ maximumPrice: 0 });
  assert.deepEqual(free.items.map((item) => item.id), ["friday-night"]);

  // An unknown dimension is a taxonomy mismatch, and an empty page would read as a
  // city with nothing in it.
  assert.throws(() => ask({ tag: "nightlife" }),
    (error) => error instanceof DomainError && error.code === "UNKNOWN_PROFILE_DIMENSION");
  assert.throws(() => ask({ minimumAffinity: 140 }),
    (error) => error instanceof DomainError && error.code === "INVALID_FILTER_VALUE");
});

test("two residents see the same city in the same order and value it differently", () => {
  const { world, clock } = experienceWorld({ credits: 500 });
  world.createCharacter({
    id: "sara", name: "Sara", locationId: "club", personality: [], goal: "Be still.",
    // The inverse of Jack: quiet, not nightlife.
    preferences: {
      music: 0, socializing: 30, learning: 60, competition: 0, spirituality: 90,
      luxury: 20, adventure: 10, relaxation: 100, creativity: 90, nature: 100,
    },
  });
  nightAtTheClub(world, clock);
  gardenNight(world, clock);

  const seenBy = (id) => world.inspectContext(id, { resource: "experiences", limit: 50 }).items;
  const jack = seenBy("jack");
  const sara = seenBy("sara");

  assert.deepEqual(jack.map((item) => item.id), sara.map((item) => item.id),
    "ordering is neutral: ranking the catalog would be the server choosing for the brain");

  const affinityOf = (items, id) => items.find((item) => item.id === id).affinity;
  assert.ok(affinityOf(jack, "friday-night") > affinityOf(sara, "friday-night"),
    "the club night is worth more to the resident who cares about music");
  assert.ok(affinityOf(sara, "midnight-garden") > affinityOf(jack, "midnight-garden"),
    "and the garden to the one who cares about quiet");
});

test("the affordance, the catalog, and the join command never disagree", () => {
  // Every way an evening can be refused, plus the one where it cannot. The catalog and
  // the command must always agree. The affordance is allowed to be absent instead of
  // blocked, because affordances list what can be attempted now, while a catalog lists
  // everything with its blockers — but it may never offer something the command refuses.
  const scenarios = [
    { name: "affordable and open", credits: 500, accessPrice: 0, capacity: null, expected: null },
    { name: "cannot afford it", credits: 10, accessPrice: 200, capacity: null, expected: "INSUFFICIENT_CREDITS" },
    { name: "already full", credits: 500, accessPrice: 0, capacity: 1, fill: true, expected: "EXPERIENCE_FULL" },
    { name: "too tired", credits: 500, accessPrice: 0, capacity: null, drain: true, expected: "INSUFFICIENT_ENERGY" },
    { name: "busy resting", credits: 500, accessPrice: 0, capacity: null, rest: true, expected: "ACTIVITY_CONFLICT" },
  ];

  for (const scenario of scenarios) {
    const { world, clock } = experienceWorld({ credits: scenario.credits });
    world.createCharacter({ id: "sara", name: "Sara", locationId: "club", personality: [], goal: "Dance." });
    nightAtTheClub(world, clock, { accessPrice: scenario.accessPrice, capacity: scenario.capacity });
    if (scenario.fill) world.joinExperience("sara", "friday-night");
    if (scenario.drain) world.changeEnergy("jack", -100, "test_setup");
    if (scenario.rest) {
      // Rest refuses a resident already at full energy, so make room for it first.
      world.changeEnergy("jack", -10, "test_setup");
      world.startRest("jack");
    }

    const catalogued = world.inspectContext("jack", { resource: "experiences", limit: 50 })
      .items.find((item) => item.id === "friday-night");
    assert.ok(catalogued, `${scenario.name}: a blocked experience is still listed`);
    assert.equal(catalogued.feasibility.eligible, scenario.expected === null,
      `${scenario.name}: catalog eligibility`);

    const offer = attendanceOffer(world, "jack", "friday-night");
    if (scenario.expected === null) {
      assert.equal(offer.orderable, true, `${scenario.name}: affordance eligibility`);
      assert.doesNotThrow(() => world.joinExperience("jack", "friday-night"),
        `${scenario.name}: an eligible evening must be enterable`);
      continue;
    }

    assert.equal(catalogued.feasibility.blockingCode, scenario.expected,
      `${scenario.name}: the catalog must name the real reason`);
    assert.ok(offer.entry === null || offer.orderable === false,
      `${scenario.name}: an affordance must never offer what the command refuses`);
    assert.throws(() => world.joinExperience("jack", "friday-night"),
      (error) => error instanceof DomainError && error.code === scenario.expected,
      `${scenario.name}: the command must refuse with the disclosed code`);
  }
});

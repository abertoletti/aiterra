import { readFileSync } from "node:fs";
import { addGameMinutes } from "../domain/clock.js";
import { defaultConfig } from "../domain/config.js";

// The taxonomy and the price bounds have one owner. Validating against a local copy
// would let a configuration pass here and be rejected by the domain half-way through
// activation, which is exactly what this validator exists to prevent.
const GRAMMAR = defaultConfig.grammar;
const EXPERIENCE = defaultConfig.experience;
const CITY = defaultConfig.city;

export class WorldConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorldConfigurationError";
    this.code = "INVALID_WORLD_CONFIGURATION";
  }
}

export function loadWorldConfiguration(filePath) {
  let document;
  try {
    document = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new WorldConfigurationError(`Cannot read world configuration: ${error.message}`);
  }
  return validateWorldConfiguration(document);
}

export function validateWorldConfiguration(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) fail("Configuration must be an object");
  if (document.schemaVersion !== 1) fail("schemaVersion must be 1");
  validId(document.version, "version");
  array(document.locations, "locations");
  array(document.connections, "connections");
  array(document.characters, "characters");
  array(document.jobs, "jobs");
  array(document.events, "events");

  const locationIds = uniqueIds(document.locations, "location");
  const locationKinds = new Set();
  const occupiedCells = new Map();
  for (const location of document.locations) {
    text(location.name, "location name", 80);
    if (!["home", "workplace", "social_venue", "other"].includes(location.kind)) fail(`Location ${location.id} has an invalid kind`);
    locationKinds.add(location.kind);
    // A seeded location sits on the grid like everything else, so one distance rule
    // covers the whole city instead of two kinds of place with two travel models.
    const placed = location.x !== undefined || location.y !== undefined;
    if (placed) {
      for (const axis of ["x", "y"]) {
        const value = location[axis];
        const limit = axis === "x" ? CITY.width : CITY.height;
        if (!Number.isInteger(value) || value < 1 || value > limit) {
          fail(`Location ${location.id} ${axis} must be an integer between 1 and ${limit}`);
        }
      }
      const cell = `${location.x},${location.y}`;
      if (occupiedCells.has(cell)) {
        fail(`Locations ${occupiedCells.get(cell)} and ${location.id} occupy the same cell ${cell}`);
      }
      occupiedCells.set(cell, location.id);
    }
  }
  if (occupiedCells.size > 0 && occupiedCells.size !== document.locations.length) {
    fail("Either every location carries grid coordinates or none does; a half-placed city has two travel models");
  }
  for (const requiredKind of ["home", "workplace", "social_venue"]) {
    if (!locationKinds.has(requiredKind)) fail(`At least one ${requiredKind} location is required`);
  }

  const connectionKeys = new Set();
  for (const connection of document.connections) {
    locationReference(connection.fromLocationId, locationIds, "connection origin");
    locationReference(connection.toLocationId, locationIds, "connection destination");
    if (connection.fromLocationId === connection.toLocationId) fail("Connections cannot point to the same location");
    positiveNumber(connection.durationGameMinutes, "connection durationGameMinutes");
    for (const key of connection.bidirectional
      ? [`${connection.fromLocationId}->${connection.toLocationId}`, `${connection.toLocationId}->${connection.fromLocationId}`]
      : [`${connection.fromLocationId}->${connection.toLocationId}`]) {
      if (connectionKeys.has(key)) fail(`Duplicate connection ${key}`);
      connectionKeys.add(key);
    }
  }

  const characterIds = uniqueIds(document.characters, "character");
  const characterCredits = new Map();
  for (const character of document.characters) {
    text(character.name, "character name", 80);
    // A character may arrive without a square: choosing one is its first decision. Only a
    // stated location has to name a real place.
    if (character.locationId !== undefined && character.locationId !== null) {
      locationReference(character.locationId, locationIds, `character ${character.id} location`);
    }
    const credits = character.credits ?? 0;
    nonNegativeNumber(credits, `character ${character.id} credits`);
    characterCredits.set(character.id, credits);
    if (character.preferences !== undefined) {
      profileVector(character.preferences, `character ${character.id} preferences`,
        { budget: GRAMMAR.preferenceBudget });
    }
  }

  const budget = document.bootstrapBudget ?? null;
  if (budget) {
    validId(budget.id, "bootstrap budget id");
    // An unlimited treasury has no figure to validate: what it will pay out is decided by
    // how much work residents do, not by a number written down in advance.
    if (!budget.unlimited) nonNegativeNumber(budget.credits, "bootstrap budget credits");
  }
  uniqueIds(document.jobs, "job");
  const reservedByCharacter = new Map();
  let reservedFromBudget = 0;
  for (const job of document.jobs) {
    text(job.title, "job title", 120);
    locationReference(job.locationId, locationIds, `job ${job.id} location`);
    positiveNumber(job.durationGameMinutes, `job ${job.id} durationGameMinutes`);
    positiveNumber(job.compensation, `job ${job.id} compensation`);
    if (job.energyCost !== undefined) positiveNumber(job.energyCost, `job ${job.id} energyCost`);
    if (!Number.isInteger(job.teamSize ?? 1) || (job.teamSize ?? 1) < 1 || (job.teamSize ?? 1) > 5) {
      fail(`Job ${job.id} teamSize must be an integer between 1 and 5`);
    }
    nonNegativeNumber(job.startsInGameMinutes ?? 0, `job ${job.id} startsInGameMinutes`);
    positiveNumber(job.offerDurationGameMinutes ?? 1_440, `job ${job.id} offerDurationGameMinutes`);
    if (job.repeatable !== undefined && typeof job.repeatable !== "boolean") {
      fail(`Job ${job.id} repeatable must be a boolean`);
    }
    if (job.cooldownGameMinutes !== undefined) positiveNumber(job.cooldownGameMinutes, `job ${job.id} cooldownGameMinutes`);
    if (job.fundingSource === "bootstrap") {
      if (!budget) fail(`Job ${job.id} requires a bootstrap budget`);
      reservedFromBudget += job.compensation;
    } else {
      if (!characterIds.has(job.creatorId)) fail(`Job ${job.id} has an unknown creator`);
      reservedByCharacter.set(job.creatorId, (reservedByCharacter.get(job.creatorId) ?? 0) + job.compensation);
    }
  }
  if (budget && !budget.unlimited && reservedFromBudget > budget.credits) fail("Bootstrap jobs exceed the configured bootstrap budget");
  for (const [characterId, reserved] of reservedByCharacter) {
    if (reserved > characterCredits.get(characterId)) fail(`Jobs created by ${characterId} exceed that character's credits`);
  }

  uniqueIds(document.events, "event");
  for (const event of document.events) {
    text(event.title, "event title", 120);
    locationReference(event.locationId, locationIds, `event ${event.id} location`);
    nonNegativeNumber(event.startsInGameMinutes, `event ${event.id} startsInGameMinutes`);
    positiveNumber(event.durationGameMinutes, `event ${event.id} durationGameMinutes`);
    if (event.creatorId && !characterIds.has(event.creatorId)) fail(`Event ${event.id} has an unknown creator`);
    // An experience without a profile delivers nothing and can produce no experiential
    // value, so a configured world that wants the engine to run has to author one.
    if (event.profile !== undefined && event.profile !== null) {
      profileVector(event.profile, `event ${event.id} profile`);
    }
    if (event.accessPrice !== undefined && event.accessPrice !== null) {
      const price = event.accessPrice;
      if (!Number.isInteger(price) || price < EXPERIENCE.minimumAccessPrice || price > EXPERIENCE.maximumAccessPrice) {
        fail(`Event ${event.id} accessPrice must be an integer between ${EXPERIENCE.minimumAccessPrice} and ${EXPERIENCE.maximumAccessPrice}`);
      }
    }
    if (event.capacity !== undefined && event.capacity !== null) {
      if (!Number.isInteger(event.capacity) || event.capacity < 1) {
        fail(`Event ${event.id} capacity must be a positive integer`);
      }
    }
    if (event.description !== undefined) text(event.description, `event ${event.id} description`, 500);
  }
  return structuredClone(document);
}

export function activateWorldConfiguration(world, input) {
  const configuration = validateWorldConfiguration(input);
  if (world.currentStateVersion() !== 0) throw new WorldConfigurationError("World configuration can only activate on an empty event store");
  const activatedAt = world.clock.now();
  world.activateWorldConfiguration({ version: configuration.version, schemaVersion: configuration.schemaVersion });
  for (const location of configuration.locations) {
    world.defineLocation({
      id: location.id, name: location.name,
      x: location.x ?? null, y: location.y ?? null,
    });
  }
  for (const connection of configuration.connections) world.defineConnection(connection);
  for (const character of configuration.characters) world.createCharacter(character);
  if (configuration.bootstrapBudget) {
    world.bootstrapEconomy({
      budgetId: configuration.bootstrapBudget.id,
      credits: configuration.bootstrapBudget.credits,
      unlimited: Boolean(configuration.bootstrapBudget.unlimited),
    });
  }
  for (const event of configuration.events) {
    const startsAt = addGameMinutes(activatedAt, event.startsInGameMinutes);
    world.createEvent({
      creatorId: event.creatorId ?? null, id: event.id, title: event.title, locationId: event.locationId,
      startsAt, endsAt: addGameMinutes(startsAt, event.durationGameMinutes),
      profile: event.profile ?? null,
      accessPrice: event.accessPrice ?? 0,
      capacity: event.capacity ?? null,
      description: event.description ?? null,
    });
  }
  for (const job of configuration.jobs) {
    const scheduledStartAt = addGameMinutes(activatedAt, job.startsInGameMinutes ?? 0);
    const offerExpiresAt = addGameMinutes(activatedAt, job.offerDurationGameMinutes ?? 1_440);
    const common = {
      id: job.id, title: job.title, locationId: job.locationId,
      durationGameMinutes: job.durationGameMinutes, compensation: job.compensation,
      requirements: job.requirements ?? {}, teamSize: job.teamSize ?? 1, scheduledStartAt, offerExpiresAt,
      energyCost: job.energyCost ?? null, teaches: job.teaches ?? null,
      repeatable: job.repeatable ?? false, cooldownGameMinutes: job.cooldownGameMinutes ?? null,
    };
    if (job.fundingSource === "bootstrap") {
      world.createSystemJob({ budgetId: configuration.bootstrapBudget.id, ...common });
    } else {
      world.createJob({ creatorId: job.creatorId, ...common });
    }
  }
  return { version: configuration.version, activatedAt: activatedAt.toISOString() };
}

function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") fail(`Every ${label} must be an object`);
    validId(item.id, `${label} id`);
    if (ids.has(item.id)) fail(`Duplicate ${label} id ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

function validId(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) fail(`${label} is invalid`);
}

function text(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) fail(`${label} must contain 1-${maximum} characters`);
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
}

function positiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) fail(`${label} must be positive`);
}

function nonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) fail(`${label} must be non-negative`);
}

function locationReference(value, locationIds, label) {
  if (!locationIds.has(value)) fail(`${label} references unknown location ${value}`);
}

// A preference vector is budgeted and an experience profile is not, because caring is
// scarce and delivering is not. Both are rejected for an unknown dimension rather than
// having it ignored, since that is a taxonomy-version mismatch and not a typo.
function profileVector(value, label, { budget = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object of profile dimensions`);
  }
  for (const dimension of Object.keys(value)) {
    if (!GRAMMAR.profileDimensions.includes(dimension)) {
      fail(`${label} has unknown profile dimension ${dimension}`);
    }
  }
  let total = 0;
  for (const dimension of GRAMMAR.profileDimensions) {
    const entry = value[dimension] ?? 0;
    if (!Number.isInteger(entry) || entry < 0 || entry > 100) {
      fail(`${label} ${dimension} must be an integer between 0 and 100`);
    }
    total += entry;
  }
  if (budget !== null && total !== budget) {
    fail(`${label} must sum to exactly ${budget}, received ${total}`);
  }
  if (budget === null && total === 0) {
    fail(`${label} must deliver at least one dimension above zero`);
  }
}

function fail(message) {
  throw new WorldConfigurationError(message);
}

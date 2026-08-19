import { readFileSync } from "node:fs";
import { addGameMinutes } from "../domain/clock.js";

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
  for (const location of document.locations) {
    text(location.name, "location name", 80);
    if (!["home", "workplace", "social_venue", "other"].includes(location.kind)) fail(`Location ${location.id} has an invalid kind`);
    locationKinds.add(location.kind);
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
    locationReference(character.locationId, locationIds, `character ${character.id} location`);
    const credits = character.credits ?? 0;
    nonNegativeNumber(credits, `character ${character.id} credits`);
    characterCredits.set(character.id, credits);
  }

  const budget = document.bootstrapBudget ?? null;
  if (budget) {
    validId(budget.id, "bootstrap budget id");
    nonNegativeNumber(budget.credits, "bootstrap budget credits");
  }
  uniqueIds(document.jobs, "job");
  const reservedByCharacter = new Map();
  let reservedFromBudget = 0;
  for (const job of document.jobs) {
    text(job.title, "job title", 120);
    locationReference(job.locationId, locationIds, `job ${job.id} location`);
    positiveNumber(job.durationGameMinutes, `job ${job.id} durationGameMinutes`);
    positiveNumber(job.compensation, `job ${job.id} compensation`);
    if (!Number.isInteger(job.teamSize ?? 1) || (job.teamSize ?? 1) < 1 || (job.teamSize ?? 1) > 5) {
      fail(`Job ${job.id} teamSize must be an integer between 1 and 5`);
    }
    nonNegativeNumber(job.startsInGameMinutes ?? 0, `job ${job.id} startsInGameMinutes`);
    positiveNumber(job.offerDurationGameMinutes ?? 1_440, `job ${job.id} offerDurationGameMinutes`);
    if (job.fundingSource === "bootstrap") {
      if (!budget) fail(`Job ${job.id} requires a bootstrap budget`);
      reservedFromBudget += job.compensation;
    } else {
      if (!characterIds.has(job.creatorId)) fail(`Job ${job.id} has an unknown creator`);
      reservedByCharacter.set(job.creatorId, (reservedByCharacter.get(job.creatorId) ?? 0) + job.compensation);
    }
  }
  if (budget && reservedFromBudget > budget.credits) fail("Bootstrap jobs exceed the configured bootstrap budget");
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
  }
  return structuredClone(document);
}

export function activateWorldConfiguration(world, input) {
  const configuration = validateWorldConfiguration(input);
  if (world.currentStateVersion() !== 0) throw new WorldConfigurationError("World configuration can only activate on an empty event store");
  const activatedAt = world.clock.now();
  world.activateWorldConfiguration({ version: configuration.version, schemaVersion: configuration.schemaVersion });
  for (const location of configuration.locations) world.defineLocation({ id: location.id, name: location.name });
  for (const connection of configuration.connections) world.defineConnection(connection);
  for (const character of configuration.characters) world.createCharacter(character);
  if (configuration.bootstrapBudget) {
    world.bootstrapEconomy({ budgetId: configuration.bootstrapBudget.id, credits: configuration.bootstrapBudget.credits });
  }
  for (const event of configuration.events) {
    const startsAt = addGameMinutes(activatedAt, event.startsInGameMinutes);
    world.createEvent({
      creatorId: event.creatorId ?? null, id: event.id, title: event.title, locationId: event.locationId,
      startsAt, endsAt: addGameMinutes(startsAt, event.durationGameMinutes),
    });
  }
  for (const job of configuration.jobs) {
    const scheduledStartAt = addGameMinutes(activatedAt, job.startsInGameMinutes ?? 0);
    const offerExpiresAt = addGameMinutes(activatedAt, job.offerDurationGameMinutes ?? 1_440);
    const common = {
      id: job.id, title: job.title, locationId: job.locationId,
      durationGameMinutes: job.durationGameMinutes, compensation: job.compensation,
      requirements: job.requirements ?? {}, teamSize: job.teamSize ?? 1, scheduledStartAt, offerExpiresAt,
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

function fail(message) {
  throw new WorldConfigurationError(message);
}

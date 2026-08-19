// Progressive decision context, contract version 1.
//
// A baseline observation carries compact summaries; detail is requested per
// resource when the decision needs it. Two rules shape everything here:
//
//   1. A catalog returns every known matching item, blocked ones included, with
//      their blockers. Progressive disclosure is a transport optimization, never
//      a server-side opinion about what the character should consider.
//   2. Ordering is deterministic and semantically neutral. Ranking a catalog by
//      predicted usefulness would be the server deciding for the brain.
//
// See docs/product-backlog/rules/progressive-context-contract.md.
import { DomainError, derivedTags, profileAffinity, publicJob } from "./world-support.js";

export const CONTEXT_CONTRACT_VERSION = 2;
export const CONTEXT_RESOURCES = ["opportunities", "experiences", "people"];
export const CONTEXT_MODES = ["full", "progressive"];

const DEFAULT_PAGE_SIZE = 20;
const MAXIMUM_PAGE_SIZE = 50;
const CHANGED_ID_CAP = 20;
const DESCRIPTION_LIMIT = 280;

const CHANGE_KINDS = new Set([
  "published", "withdrawn", "filled", "expired",
  "eligibility_changed", "rescheduled", "repriced", "terminal",
]);

const FILTERS = {
  opportunities: ["locationId", "minimumCompensation", "feasibleOnly"],
  experiences: [
    "locationId", "startsAfter", "startsBefore",
    "tag", "minimumAffinity", "maximumPrice", "feasibleOnly",
  ],
  people: ["locationId", "subjectCharacterId", "feasibleOnly"],
};

export function contextSummaries(world, characterId, since = 0) {
  return CONTEXT_RESOURCES.map((resource) => summarize(world, characterId, resource, since));
}

export function inspectCatalog(world, characterId, {
  resource, filters = {}, limit = DEFAULT_PAGE_SIZE, offset = 0,
} = {}) {
  world.requireCharacter(characterId);
  if (!CONTEXT_RESOURCES.includes(resource)) {
    throw new DomainError("UNKNOWN_CONTEXT_RESOURCE",
      `Context resource must be one of ${CONTEXT_RESOURCES.join(", ")}`, 400);
  }
  const requestedLimit = Number(limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAXIMUM_PAGE_SIZE) {
    throw new DomainError("INVALID_PAGE_SIZE", `Catalog page size must be between 1 and ${MAXIMUM_PAGE_SIZE}`, 400);
  }
  const requestedOffset = Number(offset);
  if (!Number.isInteger(requestedOffset) || requestedOffset < 0) {
    throw new DomainError("INVALID_CATALOG_OFFSET", "Catalog offset must be a non-negative integer", 400);
  }
  for (const key of Object.keys(filters)) {
    if (!FILTERS[resource].includes(key)) {
      throw new DomainError("UNKNOWN_CONTEXT_FILTER",
        `${resource} accepts only ${FILTERS[resource].join(", ")}`, 400);
    }
  }
  validateFilterValues(world, filters);

  const known = knownItems(world, characterId, resource);
  // Two separate omissions, both reported. A criteria filter removes what the agent
  // asked to exclude; feasibleOnly removes what the character cannot currently do. A
  // short list must always be distinguishable from a quiet world.
  const matching = known.filter((entry) => matchesFilters(entry, resource, filters));
  const filteredOmitted = known.length - matching.length;
  const feasibleOnly = filters.feasibleOnly === true || filters.feasibleOnly === "true";
  const visible = feasibleOnly ? matching.filter((entry) => entry.feasible) : matching;
  const blockedOmitted = feasibleOnly ? matching.length - visible.length : 0;

  const page = visible.slice(requestedOffset, requestedOffset + requestedLimit);
  const nextOffset = requestedOffset + page.length;
  return {
    resource,
    contextContractVersion: CONTEXT_CONTRACT_VERSION,
    catalogVersion: catalogVersion(world, known),
    knownCount: known.length,
    count: matching.length,
    feasibleCount: matching.filter((entry) => entry.feasible).length,
    blockedCount: matching.filter((entry) => !entry.feasible).length,
    blockedOmitted,
    filteredOmitted,
    returned: page.length,
    truncated: nextOffset < visible.length,
    nextOffset: nextOffset < visible.length ? nextOffset : null,
    appliedFilters: Object.keys(filters).sort(),
    items: page.map((entry) => entry.item),
  };
}

// An unknown dimension name is rejected rather than quietly matching nothing: it is a
// taxonomy-version mismatch, and silently returning an empty page would read to the
// agent as a city with nothing in it.
function validateFilterValues(world, filters) {
  const grammar = world.config.grammar;
  if (filters.tag !== undefined && !grammar.profileDimensions.includes(filters.tag)) {
    throw new DomainError("UNKNOWN_PROFILE_DIMENSION",
      `tag must be one of ${grammar.profileDimensions.join(", ")}`, 400);
  }
  if (filters.minimumAffinity !== undefined) {
    const value = Number(filters.minimumAffinity);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new DomainError("INVALID_FILTER_VALUE", "minimumAffinity must be between 0 and 100", 400);
    }
  }
  if (filters.maximumPrice !== undefined) {
    const value = Number(filters.maximumPrice);
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainError("INVALID_FILTER_VALUE", "maximumPrice must be a non-negative number", 400);
    }
  }
}

// Free text is bounded rather than dropped, so an oversized description can never
// remove an item or a blocker from a result.
export function boundDescription(text) {
  if (typeof text !== "string" || text.length <= DESCRIPTION_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, DESCRIPTION_LIMIT), truncated: true };
}

function summarize(world, characterId, resource, since) {
  const known = knownItems(world, characterId, resource);
  const changed = known
    .filter((entry) => itemVersion(world, entry.id) > since)
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  const overflowed = changed.length > CHANGED_ID_CAP;
  return {
    resource,
    contextContractVersion: CONTEXT_CONTRACT_VERSION,
    catalogVersion: catalogVersion(world, known),
    count: known.length,
    feasibleCount: known.filter((entry) => entry.feasible).length,
    // Beyond the cap a partial delta would read as complete, so the runtime is told
    // to re-request the catalog instead.
    changedIds: overflowed ? null : changed.map((entry) => entry.id),
    changeKinds: overflowed
      ? null
      : Object.fromEntries(changed.map((entry) => [entry.id, entry.changeKind])),
    invalidation: overflowed ? "SUMMARY_OVERFLOW" : null,
    requestAction: `inspect_${resource}`,
  };
}

function catalogVersion(world, known) {
  return known.reduce((highest, entry) => Math.max(highest, itemVersion(world, entry.id)), 0);
}

function itemVersion(world, itemId) {
  return world.state.itemVersions.get(itemId) ?? 0;
}

function knownItems(world, characterId, resource) {
  if (resource === "opportunities") return knownOpportunities(world, characterId);
  if (resource === "experiences") return knownExperiences(world, characterId);
  return knownPeople(world, characterId);
}

// Mirrors the opportunity visibility the full observation already used: open offers,
// plus anything this character works on or funds.
function knownOpportunities(world, characterId) {
  const character = world.requireCharacter(characterId);
  return [...world.state.jobs.values()]
    .filter((job) => job.status === "open"
      || job.workerIds.includes(characterId)
      || job.fundingSourceId === characterId)
    .sort((left, right) => (left.id < right.id ? -1 : 1))
    .map((job) => {
      const engaged = job.workerIds.includes(characterId) || job.fundingSourceId === characterId;
      const view = job.status === "open" ? world.jobOpportunityView(character, job) : null;
      const feasibility = view
        ? view.feasibility
        : { status: engaged ? "engaged" : "blocked", eligible: false, blockingCode: null, blockingCodes: [] };
      return {
        id: job.id,
        // Actionable now: acceptable, or already this character's to start or cancel.
        feasible: feasibility.status === "eligible" || feasibility.status === "engaged",
        changeKind: opportunityChangeKind(job),
        item: {
          ...publicJob(job, world.config.energy.workCost),
          engaged,
          feasibility,
          ...(view
            ? {
              unmetRequirements: view.unmetRequirements,
              teamSkillCoverageAfterJoin: view.teamSkillCoverageAfterJoin,
            }
            : {}),
        },
      };
    });
}

// Every public experience in the city, for every resident. Discovery is not gated on a
// prior visit or an invitation: a place someone built has to be findable by the people
// it was built for, or nobody has a reason to build one.
function knownExperiences(world, characterId) {
  const character = world.requireCharacter(characterId);
  const now = world.clock.now();
  const grammar = world.config.grammar;
  return [...world.state.gatherings.values()]
    .filter((gathering) => new Date(gathering.endsAt) >= now)
    .sort((left, right) => {
      const byStart = new Date(left.startsAt) - new Date(right.startsAt);
      return byStart !== 0 ? byStart : (left.id < right.id ? -1 : 1);
    })
    .map((gathering) => {
      const feasibility = world.eventAttendanceFeasibility(character, gathering);
      const description = boundDescription(gathering.description ?? "");
      // Affinity is arithmetic over two vectors this character already holds, so
      // withholding it would only force every runtime to recompute it. It is one of
      // seven realized factors, not a prediction of the evening: the brain owns that.
      const affinity = gathering.profile
        ? Math.round(profileAffinity(character.preferences, gathering.profile, grammar))
        : null;
      return {
        id: gathering.id,
        feasible: feasibility.eligible,
        affinity,
        accessPrice: gathering.accessPrice ?? 0,
        tags: derivedTags(gathering.profile, grammar),
        changeKind: new Date(gathering.startsAt) > now ? "published" : "eligibility_changed",
        item: {
          id: gathering.id,
          title: gathering.title,
          locationId: gathering.locationId,
          startsAt: gathering.startsAt,
          endsAt: gathering.endsAt,
          plannedDurationWorldMinutes: Math.round(
            (new Date(gathering.endsAt) - new Date(gathering.startsAt)) / 60_000),
          // What the evening delivers, and what it costs to be there. Without these an
          // agent could only learn them by standing at the door.
          profile: gathering.profile ? structuredClone(gathering.profile) : null,
          tags: derivedTags(gathering.profile, grammar),
          affinity,
          accessPrice: gathering.accessPrice ?? 0,
          capacity: gathering.capacity ?? null,
          // Who is present now, matching what capacity is gated on. `attendees` is
          // cumulative and would report a long-empty room as full.
          attendeeCount: world.currentAttendeeCount(gathering.id),
          attendanceEnergyCost: world.config.experience.entryEnergyCost,
          marginalEnergyPerWorldMinutes: world.config.experience.marginalEnergyPerWorldMinutes,
          repetition: world.repetitionOutlook(characterId, gathering),
          ...(description.text ? { description: description.text } : {}),
          ...(description.truncated ? { descriptionTruncated: true } : {}),
          feasibility,
        },
      };
    });
}

// Known people: anyone this character holds a directional relationship with, plus
// whoever is currently co-present. Never the full population.
function knownPeople(world, characterId) {
  const character = world.requireCharacter(characterId);
  const known = new Set();
  for (const key of world.state.relationships.keys()) {
    if (key.startsWith(`${characterId}->`)) known.add(key.slice(key.indexOf("->") + 2));
  }
  if (character.activity?.type !== "moving") {
    for (const other of world.state.characters.values()) {
      if (other.id !== characterId && other.locationId === character.locationId && other.activity?.type !== "moving") {
        known.add(other.id);
      }
    }
  }
  return [...known]
    .sort()
    .filter((otherId) => world.state.characters.has(otherId))
    .map((otherId) => {
      const other = world.state.characters.get(otherId);
      const coPresent = other.locationId === character.locationId
        && other.activity?.type !== "moving" && character.activity?.type !== "moving";
      const availability = coPresent
        ? world.conversationAvailability(character, other)
        : { status: "blocked", eligible: false, blockingCode: "NOT_CO_PRESENT", blockingCodes: ["NOT_CO_PRESENT"] };
      return {
        id: otherId,
        feasible: availability.eligible === true,
        changeKind: "eligibility_changed",
        item: {
          id: otherId,
          name: other.name,
          coPresent,
          // Only this character's own outgoing edge; the reverse direction is private.
          relationship: world.getRelationship(characterId, otherId),
          ...(coPresent ? { locationId: other.locationId } : {}),
          conversationAvailability: availability,
        },
      };
    });
}

function opportunityChangeKind(job) {
  if (job.status === "open") return job.workerIds.length > 0 ? "filled" : "published";
  if (job.status === "expired") return "expired";
  if (["cancelled", "failed", "completed"].includes(job.status)) return "terminal";
  return "eligibility_changed";
}

// Guards the controlled vocabulary the contract declares.
export function isKnownChangeKind(kind) {
  return CHANGE_KINDS.has(kind);
}

function matchesFilters(entry, resource, filters) {
  const item = entry.item;
  if (filters.locationId !== undefined && item.locationId !== filters.locationId) return false;
  if (filters.minimumCompensation !== undefined && Number(item.compensation ?? 0) < Number(filters.minimumCompensation)) return false;
  if (filters.startsAfter !== undefined && new Date(item.startsAt) <= new Date(filters.startsAfter)) return false;
  if (filters.startsBefore !== undefined && new Date(item.startsAt) >= new Date(filters.startsBefore)) return false;
  if (filters.subjectCharacterId !== undefined && item.id !== filters.subjectCharacterId) return false;
  // Filtering by tag is filtering by what an experience delivers to this character,
  // which is what a resident looking for a congenial evening is actually asking.
  if (filters.tag !== undefined && !(entry.tags ?? []).includes(filters.tag)) return false;
  if (filters.minimumAffinity !== undefined
    && (entry.affinity === null || entry.affinity === undefined
      || entry.affinity < Number(filters.minimumAffinity))) return false;
  if (filters.maximumPrice !== undefined && Number(entry.accessPrice ?? 0) > Number(filters.maximumPrice)) return false;
  return true;
}

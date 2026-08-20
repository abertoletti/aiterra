// An observation now separates what a character can do right now from what merely exists.
// `availableActions` is the menu: every entry is orderable, and it carries no feasibility
// field because being listed is the guarantee. `opportunities` is the map: everything real
// but not yet possible, with every field it always had, plus `blockedBy` for what is
// specific to it. `cannotRightNow` states a cause once when it blocks a whole class.
//
// Tests that care about disclosure should say which list they expect, because that is the
// contract. These helpers make that assertion short rather than merging the two back
// together, which would defeat the point of having split them.

export function offered(observation, predicate) {
  const orderable = (observation.availableActions ?? []).find(predicate);
  if (orderable) return { entry: orderable, orderable: true };
  const blocked = (observation.opportunities ?? []).find(predicate);
  if (blocked) return { entry: blocked, orderable: false };
  return { entry: null, orderable: false };
}

export const byType = (type) => (entry) => entry.type === type;

export const byEvent = (type, eventId) => (entry) => entry.type === type && entry.eventId === eventId;

export const byJob = (type, jobId) => (entry) => entry.type === type && entry.jobId === jobId;

// The reason a whole class is impossible, if one was lifted out of it.
export function classReasons(observation, action) {
  return (observation.cannotRightNow ?? [])
    .filter((reason) => reason.action === action)
    .map((reason) => reason.code)
    .sort();
}

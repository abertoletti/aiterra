// Residents now choose their own square as their first decision, so a world loaded from the
// pilot configuration starts with nobody anywhere. Tests about a city in motion want it
// already settled; this puts everyone where the configuration used to put them, through the
// same command a brain would use.
export const STARTING_SQUARES = {
  "pilot-01": "archive", "pilot-02": "garden", "pilot-03": "foundry", "pilot-04": "garden",
  "pilot-05": "market", "pilot-06": "market", "pilot-07": "foundry", "pilot-08": "foundry",
  "pilot-09": "garden", "pilot-10": "garden",
};

export function settleEveryone(world, squares = STARTING_SQUARES) {
  for (const [characterId, locationId] of Object.entries(squares)) {
    if (!world.state.characters.has(characterId)) continue;
    if (world.state.characters.get(characterId).locationId) continue;
    world.enterWorld(characterId, locationId);
  }
  return world;
}

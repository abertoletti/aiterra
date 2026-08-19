import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the world observer declares every dashboard mount point used by its script", () => {
  const html = readFileSync("public/index.html", "utf8");
  const script = readFileSync("public/app.js", "utf8");
  const ids = [...script.matchAll(/document\.querySelector\("#([a-z0-9-]+)"\)/g)].map((match) => match[1]);

  assert.ok(ids.length >= 15, "the observer should expose the world and resident dashboard regions");
  for (const id of ids) assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  assert.equal(new Set(ids).size, ids.length, "dashboard mount points should be bound once");
  assert.match(html, /World operations/);
  assert.match(html, /Economy &amp; rules|Economy & rules/);
  assert.match(script, /AI brains online/);
  assert.match(script, /openJobCount/);
  assert.match(script, /energyCost/);
  assert.match(script, /conversationTurnEnergyCost/);
});

test("world operations and selected resident are separate observer sections", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const worldSection = html.indexOf('class="observer-section world-section"');
  const residentSection = html.indexOf('class="observer-section resident-section"');
  const residentTitle = html.indexOf(">Selected Resident<");
  const picker = html.indexOf('id="character-select"');

  assert.ok(worldSection >= 0);
  assert.ok(residentSection > worldSection);
  assert.ok(residentTitle > residentSection);
  assert.ok(picker > residentTitle, "the resident picker should sit beside the selected-resident heading");
});

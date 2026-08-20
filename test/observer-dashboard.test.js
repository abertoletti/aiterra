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

test("the observer is paged, and every tab has a page to show", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

  // One long scroll made the map, the job board and one resident's life compete for the
  // same attention. Each page now answers a single question.
  const tabs = [...html.matchAll(/data-page="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["overview", "residents", "city", "economy", "health"]);
  for (const page of tabs) {
    assert.match(html, new RegExp(`id="page-${page}"`), `missing the ${page} page`);
  }
  assert.match(script, /const pages = \["overview", "residents", "city", "economy", "health"\]/,
    "the router and the tab bar must agree on the page list");

  // World operations and one resident's detail stay separate sections, in that order.
  const worldSection = html.indexOf("observer-section world-section");
  const residentSection = html.indexOf("observer-section resident-section");
  const residentTitle = html.indexOf(">Selected Resident<");
  const picker = html.indexOf('id="character-select"');
  assert.ok(worldSection >= 0);
  assert.ok(residentSection > worldSection);
  assert.ok(residentTitle > residentSection);
  assert.ok(picker > residentTitle, "the resident picker should sit beside the selected-resident heading");
});

test("the health page exists, because a run once stalled in silence", () => {
  const script = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  // Four of seven brains stopped answering for two hours while the dashboard showed a
  // busy world. Availability is now a first-class page with its own tab badge.
  assert.match(script, /agentAvailability/);
  assert.match(script, /consecutiveMissedResponses/);
  assert.match(script, /healthBadge/);
});
test("a wallet shows the balances and keeps the ledger behind a disclosure", () => {
  const script = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

  // Four reconciling numbers answer the question at a glance; the itemised movements are a
  // follow-up question, not a headline, so they open on request.
  for (const total of ["Opened with", "Earned", "Spent", "Balance"]) {
    assert.ok(script.includes(total), `the wallet must state ${total}`);
  }
  assert.match(script, /<details class="wallet-details" data-keep="wallet">/,
    "the ledger opens on request rather than filling the panel");
  // And what the reader opened stays open: the panel redraw must reopen marked
  // disclosures, or every refresh slams the ledger shut mid-read.
  assert.match(script, /details\[data-keep\]\[open\]/,
    "open disclosures survive a panel re-render");
  assert.match(script, /purse\.opening/);

  // The profile is a full-width band above the story: at 360px in a sticky column it pushed
  // everything worth reading below the fold.
  assert.match(styles, /\.dashboard \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(styles, /\.character-panel \{[^}]*position: sticky/);
});

test("every meter width is a class, because the page's own CSP blocks inline styles", () => {
  const script = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  // style-src 'self' blocks an inline style attribute in parsed markup, so every bar in the
  // observer used to draw at zero width with nothing to show but a console error.
  assert.match(server, /style-src 'self'/, "the header stays strict");
  assert.ok(!/style="width/.test(script), "no width may be set through a style attribute");
  assert.match(script, /function fillClass\(/);
  for (const percent of [0, 50, 100]) {
    assert.ok(styles.includes(`.meter-fill.fill-${percent}`), `a class must exist for ${percent}%`);
  }
});

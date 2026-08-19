const state = { world: null, selectedId: null, worldTimeline: [] };
const select = document.querySelector("#character-select");
const panel = document.querySelector("#character-panel");
const timeline = document.querySelector("#timeline");
const eventCount = document.querySelector("#event-count");
const worldTime = document.querySelector("#world-time");
const worldSummary = document.querySelector("#world-summary");
const locationGrid = document.querySelector("#location-grid");
const locationMeta = document.querySelector("#location-meta");
const jobList = document.querySelector("#job-list");
const jobMeta = document.querySelector("#job-meta");
const eventList = document.querySelector("#event-list");
const eventMeta = document.querySelector("#event-meta");
const economyOverview = document.querySelector("#economy-overview");
const worldActivity = document.querySelector("#world-activity");
const worldEventCount = document.querySelector("#world-event-count");
const cityMap = document.querySelector("#city-map");
const cityMeta = document.querySelector("#city-meta");
const buildingList = document.querySelector("#building-list");

select.addEventListener("change", () => {
  state.selectedId = select.value;
  renderCharacter();
  loadCharacterTimeline();
});

await refresh();
setInterval(refresh, 5_000);

async function refresh() {
  try {
    const [stateResponse, timelineResponse] = await Promise.all([
      fetch("/api/state"),
      fetch("/api/timeline"),
    ]);
    if (!stateResponse.ok || !timelineResponse.ok) throw new Error("The world is temporarily unavailable.");
    state.world = await stateResponse.json();
    state.worldTimeline = (await timelineResponse.json()).items;
    state.selectedId ??= state.world.characters[0]?.id;
    worldTime.textContent = formatWorldTime(state.world.worldTime);
    renderPicker();
    renderWorldOverview();
    renderCharacter();
    renderWorldActivity();
    await loadCharacterTimeline();
  } catch (error) {
    panel.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    worldSummary.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function renderPicker() {
  const previous = select.value;
  select.replaceChildren(...state.world.characters.map((character) => {
    const option = document.createElement("option");
    option.value = character.id;
    option.textContent = character.name;
    return option;
  }));
  select.value = state.selectedId || previous;
}

function renderWorldOverview() {
  const overview = state.world.overview;
  const runtime = state.world.runtime ?? { connectedAgentBrains: 0, eventStreamConnections: 0 };
  worldSummary.innerHTML = [
    summaryCard("Population", overview.totalCharacters, `${overview.busyCharacters} active · ${overview.idleCharacters} idle`, "population"),
    summaryCard("AI brains online", `${runtime.connectedAgentBrains} / ${overview.totalCharacters}`, `${runtime.eventStreamConnections} live event streams`, runtime.connectedAgentBrains ? "online" : "offline"),
    summaryCard("Average energy", `${number(overview.averageEnergy)}%`, `${energyBand(overview.averageEnergy)} capacity`, "energy"),
    summaryCard("Job market", overview.openJobs, `${overview.runningJobs} running · ${overview.teamJobs} team jobs`, "jobs"),
    summaryCard("Social pulse", overview.activeConversations, `${overview.openInvitations} invites · ${overview.scheduledCommitments} commitments`, "social"),
    summaryCard("Live events", overview.activeEvents, `${state.world.events.filter((event) => event.status === "scheduled").length} upcoming`, "events"),
  ].join("");

  renderLocations();
  renderJobs();
  renderEvents();
  renderEconomy();
  renderCity();
}

// The grid as it actually stands: who owns what, what is going up, and what each
// finished place delivers. A cell is small on purpose - the whole city has to be
// readable at once, or an operator cannot see a district forming.
function renderCity() {
  const city = state.world.city;
  if (!city) return;
  const buildingsByCell = new Map();
  for (const building of city.buildings) {
    for (let dx = 0; dx < building.width; dx += 1) {
      for (let dy = 0; dy < building.height; dy += 1) {
        buildingsByCell.set(`${building.x + dx},${building.y + dy}`, building);
      }
    }
  }
  const plotsByCell = new Map(city.plots.map((plot) => [`${plot.x},${plot.y}`, plot]));
  const seededByCell = new Map(city.seededLocations
    .filter((location) => Number.isInteger(location.x))
    .map((location) => [`${location.x},${location.y}`, location]));
  const residentsByLocation = new Map();
  for (const location of state.world.locations) {
    residentsByLocation.set(location.id, location.population);
  }

  const active = city.buildings.filter((building) => building.status === "ACTIVE").length;
  const rising = city.buildings.filter((building) => building.status === "UNDER_CONSTRUCTION").length;
  cityMeta.textContent = `${city.width}x${city.height} · ${city.plots.length} plots held · ${active} built`
    + (rising ? ` · ${rising} rising` : "");

  const cells = [];
  for (let y = 1; y <= city.height; y += 1) {
    for (let x = 1; x <= city.width; x += 1) {
      const key = `${x},${y}`;
      const building = buildingsByCell.get(key);
      const seeded = seededByCell.get(key);
      const plot = plotsByCell.get(key);
      let className = "cell";
      let label = "";
      let title = `${x},${y} · empty land`;
      if (seeded) {
        className += " seeded";
        label = seeded.name.slice(0, 1);
        title = `${seeded.name} · ${residentsByLocation.get(seeded.id) ?? 0} here now`;
      } else if (building) {
        className += building.status === "ACTIVE" ? " building"
          : building.status === "UNDER_CONSTRUCTION" ? " rising" : " delinquent";
        label = building.name.slice(0, 1);
        const here = residentsByLocation.get(building.locationId) ?? 0;
        title = `${building.name} — ${building.status.toLowerCase()}\n`
          + `${characterName(building.proprietorId)} · ${building.tags.join(", ") || "no tags"}\n`
          + `balance ${building.balance} · earned ${building.revenue} · upkeep ${building.dailyUpkeep}/day\n`
          + `${here} here now`;
      } else if (plot?.ownerId) {
        className += " owned";
        title = `${x},${y} · held by ${characterName(plot.ownerId)}`;
      }
      cells.push(`<i class="${className}" title="${escapeHtml(title)}">${escapeHtml(label)}</i>`);
    }
  }
  cityMap.style.setProperty("--columns", city.width);
  cityMap.innerHTML = cells.join("");

  buildingList.innerHTML = city.buildings.length
    ? city.buildings.map((building) => `
      <article class="building-card ${building.status.toLowerCase()}">
        <div class="building-topline">
          <div>
            <span class="location-id">${escapeHtml(building.x + "," + building.y)} · ${escapeHtml(building.status.toLowerCase())}</span>
            <h3>${escapeHtml(building.name)}</h3>
          </div>
          <strong class="population-count">${building.capacity}</strong>
        </div>
        <p class="location-caption">${escapeHtml(characterName(building.proprietorId))} · ${escapeHtml(building.tags.join(" · ") || "no tags")}</p>
        ${building.description ? `<p class="building-description">${escapeHtml(building.description)}</p>` : ""}
        <div class="location-signals">
          <span>built for ${building.constructionCost}</span>
          <span>earned ${building.revenue}</span>
          <span>balance ${building.balance}</span>
          <span>upkeep ${building.dailyUpkeep}/day</span>
        </div>
        <p class="routes">Can: ${escapeHtml(building.capabilities.join(" · "))}</p>
      </article>`).join("")
    : `<p class="empty-note">Nobody has built anything yet. Residents buy plots at ${city.plotPrice} credits and choose what their place delivers.</p>`;
}

function characterName(characterId) {
  return characterById(characterId)?.name ?? characterId ?? "unknown";
}

function renderLocations() {
  locationMeta.textContent = `${state.world.locations.length} places · ${worldRouteCount()} routes`;
  locationGrid.innerHTML = state.world.locations.map((location) => {
    const occupants = location.occupantIds.map(characterById).filter(Boolean);
    const routes = uniqueRoutesFrom(location.id);
    return `
      <article class="location-card">
        <div class="location-topline">
          <div><span class="location-id">${escapeHtml(location.id)}</span><h3>${escapeHtml(location.name)}</h3></div>
          <strong class="population-count">${location.population}</strong>
        </div>
        <p class="location-caption">${plural(location.population, "resident")} here now</p>
        <div class="occupants">${occupants.length
          ? occupants.map((character) => `<span title="${escapeHtml(describeActivity(character.activity, location.name).title)}">${escapeHtml(character.name)}</span>`).join("")
          : `<span class="empty-chip">Empty</span>`}</div>
        <div class="location-signals">
          <span>${location.openJobCount} open ${location.openJobCount === 1 ? "job" : "jobs"}</span>
          <span>${location.activeEventCount} live ${location.activeEventCount === 1 ? "event" : "events"}</span>
        </div>
        <p class="routes">Routes: ${routes.length ? routes.map((route) => `${escapeHtml(route.name)} (${route.duration}m)`).join(" · ") : "none"}</p>
      </article>`;
  }).join("");
}

function renderJobs() {
  const statuses = countBy(state.world.jobs, (job) => job.status);
  jobMeta.textContent = `${statuses.open ?? 0} open · ${statuses.running ?? 0} running · ${statuses.completed ?? 0} completed`;
  const statusOrder = { running: 0, accepted: 1, open: 2, completed: 3, cancelled: 4, failed: 5, expired: 6 };
  const jobs = [...state.world.jobs].sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));
  jobList.innerHTML = jobs.length ? jobs.map((job) => {
    const location = locationById(job.locationId);
    const workers = (job.workerIds ?? [job.workerId]).map(characterById).filter(Boolean);
    const requirements = Object.entries(job.requirements ?? {}).filter(([, value]) => value > 0);
    return `
      <article class="job-row">
        <div class="job-primary">
          <div class="job-title-line"><span class="status-badge status-${escapeHtml(job.status)}">${escapeHtml(job.status)}</span><h3>${escapeHtml(job.title)}</h3></div>
          <p>${escapeHtml(location?.name ?? job.locationId)}${workers.length ? ` · ${job.teamSize > 1 ? "team" : "assigned to"} <strong>${workers.map((worker) => escapeHtml(worker.name)).join(", ")}</strong>` : " · unassigned"}</p>
        </div>
        <dl class="job-facts">
          <div><dt>Pay</dt><dd>${number(job.compensation)} cr</dd></div>
          <div><dt>Duration</dt><dd>${formatDuration(job.durationGameMinutes)}</dd></div>
          <div><dt>Energy</dt><dd>${job.energyCost} / ${state.world.rules.maximumEnergy}</dd></div>
          <div><dt>Requirements</dt><dd>${requirements.length ? requirements.map(([skill, value]) => `${humanize(skill)} ${value}+`).join(", ") : "None"}</dd></div>
          ${job.teamSize > 1 ? `<div><dt>Team</dt><dd>${workers.length} / ${job.teamSize} · collective coverage</dd></div>` : ""}
        </dl>
        <div class="job-window">
          <span>Starts ${formatDateTime(job.scheduledStartAt)}</span>
          <span>Offer closes ${formatDateTime(job.offerExpiresAt)}</span>
        </div>
      </article>`;
  }).join("") : `<p class="empty-state">No jobs exist in this world.</p>`;
}

function renderEvents() {
  const statuses = countBy(state.world.events, (event) => event.status);
  eventMeta.textContent = `${statuses.active ?? 0} live · ${statuses.scheduled ?? 0} upcoming`;
  const order = { active: 0, scheduled: 1, ended: 2 };
  const events = [...state.world.events].sort((a, b) => order[a.status] - order[b.status]);
  eventList.innerHTML = events.length ? events.map((event) => {
    const location = locationById(event.locationId);
    const attendees = event.activeAttendeeIds.map(characterById).filter(Boolean);
    return `
      <article class="event-card">
        <div class="event-heading"><span class="status-badge status-${escapeHtml(event.status)}">${escapeHtml(event.status)}</span><span>${event.energyCost} energy</span></div>
        <h3>${escapeHtml(event.title)}</h3>
        <p>${escapeHtml(location?.name ?? event.locationId)} · ${formatDuration(event.durationGameMinutes)}</p>
        <div class="event-time"><span>${formatDateTime(event.startsAt)}</span><span>→ ${formatDateTime(event.endsAt)}</span></div>
        <p class="attendance"><strong>${attendees.length}</strong> attending now${attendees.length ? ` · ${attendees.map((character) => escapeHtml(character.name)).join(", ")}` : ""}</p>
      </article>`;
  }).join("") : `<p class="empty-state">No world events are scheduled.</p>`;
}

function renderEconomy() {
  const overview = state.world.overview;
  const budgets = state.world.economy.systemBudgets;
  economyOverview.innerHTML = `
    <div class="economy-numbers">
      ${economyMetric("Resident wallets", overview.characterCredits, "credits in circulation")}
      ${economyMetric("Reserved escrow", overview.reservedCredits, "credits securing jobs")}
      ${economyMetric("World budget", overview.systemBudgetBalance, "credits available")}
    </div>
    <div class="rules-block">
      <h3>World operating rules</h3>
      <ul>
        <li><span>Time scale</span><strong>${state.world.rules.realHoursPerGameDay} real hours / world day</strong></li>
        <li><span>Move cost</span><strong>${state.world.rules.movementEnergyCost} energy</strong></li>
        <li><span>Work cost</span><strong>${state.world.rules.workEnergyCost} energy</strong></li>
        <li><span>Event cost</span><strong>${state.world.rules.eventAttendanceEnergyCost} energy</strong></li>
        <li><span>Conversation</span><strong>${state.world.rules.conversationStartEnergyCost} start + ${state.world.rules.conversationTurnEnergyCost} / turn (${state.world.rules.extendedConversationTurnEnergyCost} from turn ${state.world.rules.extendedConversationStartsAtTurn})</strong></li>
        <li><span>Conversation limit</span><strong>${state.world.rules.maximumConversationTurns} turns</strong></li>
        <li><span>Same-pair cooldown</span><strong>${state.world.rules.samePairCooldownWorldMinutes} world min</strong></li>
        <li><span>Rest</span><strong>+${state.world.rules.restRecovery} over ${formatDuration(state.world.rules.restDurationGameMinutes)}</strong></li>
      </ul>
    </div>
    ${budgets.length ? `<p class="budget-note">Budget source: ${budgets.map((budget) => escapeHtml(budget.id)).join(", ")}</p>` : ""}`;
}

function renderWorldActivity() {
  const recent = state.worldTimeline.slice(-10).reverse();
  worldEventCount.textContent = `${state.worldTimeline.length} meaningful events`;
  worldActivity.innerHTML = recent.length ? recent.map((item) => `
    <li class="activity-${activityCategory(item.type)}">
      <time datetime="${item.at}">${formatTime(item.at)}</time>
      <div><span>${humanize(item.type)}</span><p>${escapeHtml(item.text)}</p></div>
    </li>`).join("") : `<li class="empty-state">The world has no activity yet.</li>`;
}

function renderCharacter() {
  const character = characterById(state.selectedId);
  if (!character) return;
  const location = locationById(character.locationId)?.name ?? character.locationId;
  const activity = describeActivity(character.activity, location);
  const relationships = character.importantRelationships.slice(0, 4).map((relationship) => `
    <li>
      <span>${escapeHtml(relationship.name)}</span>
      <span class="relationship ${relationship.affinity < 0 || relationship.trust < 0 ? "negative" : "positive"}" title="Affinity, trust, tension">A ${signed(relationship.affinity)} · Tr ${signed(relationship.trust)} · X ${relationship.tension}</span>
    </li>`).join("");

  panel.innerHTML = `
    <div class="identity">
      <div class="avatar" aria-hidden="true">${escapeHtml(character.name[0])}</div>
      <div><p class="eyebrow">Resident profile</p><h2>${escapeHtml(character.name)}</h2></div>
    </div>
    <div class="now-card">
      <span class="now-label">Right now</span>
      <strong>${escapeHtml(activity.title)}</strong>
      <span>${escapeHtml(activity.detail)}</span>
    </div>
    <div class="stats">
      ${stat("Energy", `${character.energy} / ${state.world.rules.maximumEnergy}`)}
      ${stat("Credits", number(character.credits))}
      ${stat("Reputation", character.reputation)}
      ${stat("Score", character.score)}
    </div>
    <div class="goal-block"><span>Long-term objective</span><p>${escapeHtml(character.goal)}</p></div>
    <div class="relationships">
      <div class="minor-heading"><h3>Relationships</h3><span>directional</span></div>
      <ul>${relationships || "<li><span>No relationships yet</span></li>"}</ul>
    </div>`;
}

async function loadCharacterTimeline() {
  if (!state.selectedId) return;
  const response = await fetch(`/api/timeline?characterId=${encodeURIComponent(state.selectedId)}`);
  if (!response.ok) return;
  const data = await response.json();
  eventCount.textContent = `${data.items.length} meaningful events`;
  timeline.replaceChildren(...data.items.map((item, index) => {
    const row = document.createElement("li");
    row.className = isTurningPoint(item.type) ? "turning-point" : "";
    row.innerHTML = `
      <time datetime="${item.at}">${formatTime(item.at)}</time>
      <div class="timeline-marker"><span></span></div>
      <div class="event-copy">
        <p>${escapeHtml(item.text)}</p>
        ${item.causedByEventIds.length ? `<span class="causal">↳ follows from ${item.causedByEventIds.length} earlier event${item.causedByEventIds.length > 1 ? "s" : ""}</span>` : ""}
      </div>`;
    row.style.setProperty("--delay", `${Math.min(index * 25, 350)}ms`);
    return row;
  }));
}

function summaryCard(label, value, detail, accent) {
  return `<article class="summary-card accent-${accent}"><span>${label}</span><strong>${value}</strong><p>${detail}</p></article>`;
}

function economyMetric(label, value, detail) {
  return `<div class="economy-metric"><span>${label}</span><strong>${number(value)}</strong><small>${detail}</small></div>`;
}

function describeActivity(activity, location) {
  if (!activity) return { title: "Taking stock", detail: `Idle at ${location}` };
  if (activity.type === "work") return { title: activity.title, detail: `Working at ${location} until ${formatTime(activity.expectedEndAt)}` };
  if (activity.type === "moving") return { title: "On the move", detail: `Travelling to ${locationById(activity.destinationId)?.name ?? activity.destinationId}` };
  if (activity.type === "attend_event") return { title: activity.title, detail: `Attending at ${location}` };
  if (activity.type === "rest") return { title: "Resting", detail: `Recovering at ${location} until ${formatTime(activity.expectedEndAt)}` };
  return { title: humanize(activity.type), detail: location };
}

function uniqueRoutesFrom(locationId) {
  const routes = new Map();
  for (const connection of state.world.connections.filter((item) => item.fromLocationId === locationId)) {
    const destination = locationById(connection.toLocationId);
    routes.set(connection.toLocationId, { name: destination?.name ?? connection.toLocationId, duration: connection.durationGameMinutes });
  }
  return [...routes.values()];
}

function worldRouteCount() {
  return new Set(state.world.connections.map((connection) =>
    [connection.fromLocationId, connection.toLocationId].sort().join("↔"))).size;
}

function characterById(id) { return state.world?.characters.find((item) => item.id === id); }
function locationById(id) { return state.world?.locations.find((item) => item.id === id); }
function stat(label, value) { return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`; }
function isTurningPoint(type) { return ["AGENT_NOTIFICATION_QUEUED", "KNOWLEDGE_LEARNED", "RELATIONSHIP_CHANGED", "DECISION_RECORDED"].includes(type); }
function activityCategory(type) {
  if (type.startsWith("JOB_")) return "job";
  if (type.startsWith("CONVERSATION_") || type.startsWith("RELATIONSHIP_")) return "social";
  if (type.startsWith("EVENT_")) return "event";
  return "world";
}
function countBy(items, selector) {
  return items.reduce((counts, item) => ({ ...counts, [selector(item)]: (counts[selector(item)] ?? 0) + 1 }), {});
}
function energyBand(value) { return value >= 70 ? "Healthy" : value >= 40 ? "Moderate" : "Low"; }
function formatWorldTime(value) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value)); }
function formatTime(value) { return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value)); }
function formatDateTime(value) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value)); }
function formatDuration(gameMinutes) {
  const game = gameMinutes >= 60 ? `${number(gameMinutes / 60)} world h` : `${gameMinutes} world min`;
  const realMinutes = gameMinutes * state.world.rules.realHoursPerGameDay / 24;
  const real = realMinutes >= 60 ? `${number(realMinutes / 60)} real h` : `${number(realMinutes)} real min`;
  return `${game} · ${real}`;
}
function number(value) { return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value); }
function plural(value, noun) { return `${value} ${noun}${value === 1 ? "" : "s"}`; }
function signed(value) { return value > 0 ? `+${value}` : String(value); }
function humanize(value) { return String(value).toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }

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
const residentsTable = document.querySelector("#residents-table");
const residentsMeta = document.querySelector("#residents-meta");
const standings = document.querySelector("#standings");
const standingsMeta = document.querySelector("#standings-meta");
const standingsNote = document.querySelector("#standings-note");
const tabs = document.querySelector("#tabs");
const healthTable = document.querySelector("#health-table");
const healthMeta = document.querySelector("#health-meta");
const healthNote = document.querySelector("#health-note");
const healthSummary = document.querySelector("#health-summary");
const healthBadge = document.querySelector("#health-badge");

// Pages rather than one long scroll. The hash carries the page so a reload, or a link
// sent to someone else, lands where it was.
const pages = ["overview", "residents", "city", "economy", "health"];

function showPage(name) {
  const page = pages.includes(name) ? name : "overview";
  for (const candidate of pages) {
    document.querySelector(`#page-${candidate}`).hidden = candidate !== page;
  }
  for (const tab of tabs.querySelectorAll(".tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.page === page));
  }
  if (location.hash.slice(1) !== page) history.replaceState(null, "", `#${page}`);
}

tabs.addEventListener("click", (clickEvent) => {
  const tab = clickEvent.target.closest(".tab");
  if (tab) showPage(tab.dataset.page);
});
window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));
showPage(location.hash.slice(1));

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
  renderStandings();
  renderResidents();
  renderCity();
  renderHealth();
}

// A run once ran for two hours while four of seven brains had stopped answering. The
// world kept ticking, events kept flowing, and nothing on this dashboard said so. A
// resident whose brain is not answering is not a quiet resident, it is a stopped one.
function renderHealth() {
  const residents = state.world.characters;
  const runtime = state.world.runtime ?? { connectedAgentBrains: 0, eventStreamConnections: 0 };
  const rules = state.world.rules;
  const stopped = residents.filter((resident) => resident.agentAvailability !== "available");
  const struggling = residents.filter((resident) =>
    resident.agentAvailability === "available" && (resident.consecutiveMissedResponses ?? 0) > 0);

  healthBadge.textContent = stopped.length ? String(stopped.length) : "";
  healthBadge.className = `tab-badge ${stopped.length ? "alert" : ""}`;

  healthSummary.innerHTML = [
    summaryCard("Brains answering", `${residents.length - stopped.length} / ${residents.length}`,
      stopped.length ? `${stopped.length} stopped` : "all responding", stopped.length ? "offline" : "online"),
    summaryCard("Connected", `${runtime.connectedAgentBrains} / ${residents.length}`,
      `${runtime.eventStreamConnections} live event streams`, runtime.connectedAgentBrains ? "online" : "offline"),
    summaryCard("Missing replies", struggling.length, struggling.length ? "at least one missed" : "none pending", "social"),
    summaryCard("World speed", `${rules.realHoursPerGameDay}h`, "of real time per world day", "energy"),
  ].join("");

  healthMeta.textContent = stopped.length
    ? `${stopped.map((resident) => resident.name).join(", ")} stopped deciding`
    : "every brain is answering";

  healthTable.innerHTML = `
    <table>
      <thead>
        <tr><th>Resident</th><th>Brain</th><th class="num">Missed in a row</th><th>Doing</th><th class="num">Energy</th></tr>
      </thead>
      <tbody>
        ${[...residents]
    .sort((left, right) => (right.consecutiveMissedResponses ?? 0) - (left.consecutiveMissedResponses ?? 0))
    .map((resident) => {
      const missed = resident.consecutiveMissedResponses ?? 0;
      const down = resident.agentAvailability !== "available";
      return `
          <tr class="${down ? "brain-down" : ""}">
            <td><button class="resident-link" data-resident="${escapeHtml(resident.id)}">${escapeHtml(resident.name)}</button></td>
            <td><span class="brain-chip ${down ? "poor" : "good"}">${escapeHtml(resident.agentAvailability)}</span></td>
            <td class="num">${missed || "—"}</td>
            <td class="doing">${escapeHtml(describeActivity(resident.activity, locationById(resident.locationId)?.name ?? resident.locationId).title)}</td>
            <td class="num">${resident.energy}</td>
          </tr>`;
    }).join("")}
      </tbody>
    </table>`;

  healthNote.textContent = `A brain is marked unavailable after ${rules.unavailableAfterMissedResponses ?? 3} `
    + "missed replies in a row. It keeps a body in the world and stops making decisions for it, "
    + "which looks identical to a resident who has nothing to do.";

  for (const button of healthTable.querySelectorAll(".resident-link")) {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.resident;
      select.value = state.selectedId;
      showPage("residents");
      renderWorldOverview();
      renderCharacter();
      loadCharacterTimeline();
    });
  }
}

// A run is won on Credits, what was actually lived, and the relationships that came to
// matter. The score policy is still Draft - no weights are approved - so this ranks by
// each pillar and combines them by SUM OF RANKS, which needs no weights and no
// normalisation. It is a standing, not the Score, and it says so.
function renderStandings() {
  const residents = state.world.characters;
  if (residents.length === 0) return;
  const buildings = state.world.city?.buildings ?? [];

  const pillars = [
    { key: "credits", label: "Credits", of: (resident) => resident.credits },
    { key: "lived", label: "Lived", of: (resident) => round1(resident.livedHappiness ?? 0) },
    {
      key: "bonds",
      label: "Bonds",
      of: (resident) => (resident.importantRelationships ?? [])
        .reduce((total, relationship) => total + Math.max(0, relationship.strength ?? 0), 0),
    },
  ];

  const rankOf = {};
  for (const pillar of pillars) {
    const ordered = [...residents].sort((left, right) => pillar.of(right) - pillar.of(left));
    ordered.forEach((resident, index) => {
      rankOf[resident.id] ??= {};
      // Equal values share a rank, or a tie would decide the standing by array order.
      const tied = ordered.findIndex((other) => pillar.of(other) === pillar.of(resident));
      rankOf[resident.id][pillar.key] = tied + 1;
    });
  }

  const table = residents
    .map((resident) => {
      const ranks = rankOf[resident.id];
      return {
        resident,
        ranks,
        rankSum: pillars.reduce((total, pillar) => total + ranks[pillar.key], 0),
        built: buildings.filter((building) => building.proprietorId === resident.id).length,
      };
    })
    .sort((left, right) => left.rankSum - right.rankSum
      || right.resident.livedHappiness - left.resident.livedHappiness);

  const leader = table[0];
  standingsMeta.textContent = leader ? `${leader.resident.name} leads` : "";
  standings.innerHTML = table.map((entry, index) => `
    <div class="standing ${index === 0 ? "leader" : ""} ${entry.resident.id === state.selectedId ? "selected" : ""}">
      <span class="place">${index + 1}</span>
      <button class="resident-link" data-resident="${escapeHtml(entry.resident.id)}">${escapeHtml(entry.resident.name)}</button>
      <span class="pillars">
        ${pillars.map((pillar) => `
          <span class="pillar" title="${pillar.label}: rank ${entry.ranks[pillar.key]} of ${residents.length}">
            <span class="pillar-label">${pillar.label}</span>
            <span class="pillar-value">${pillar.key === "lived" ? signed(pillar.of(entry.resident)) : number(pillar.of(entry.resident))}</span>
            <span class="pillar-rank">#${entry.ranks[pillar.key]}</span>
          </span>`).join("")}
      </span>
      <span class="built-badge" title="buildings owned">${entry.built ? `${entry.built} built` : ""}</span>
    </div>`).join("");

  standingsNote.textContent = "Ranked by sum of places across the three things a run is won on. "
    + "No approved Score formula exists yet, so nothing here is weighted.";

  for (const button of standings.querySelectorAll(".resident-link")) {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.resident;
      select.value = state.selectedId;
      renderWorldOverview();
      renderCharacter();
      loadCharacterTimeline();
    });
  }
}

// Everyone at once. The selected-resident panel answers "what is this person like";
// this answers "who is winning, and who is having a bad time", which is the question an
// observer actually opens the page with.
function renderResidents() {
  const residents = [...state.world.characters]
    .sort((left, right) => right.livedHappiness - left.livedHappiness);
  const buildings = state.world.city?.buildings ?? [];
  const lived = residents.map((resident) => Math.abs(resident.livedHappiness ?? 0));
  const livedScale = Math.max(1, ...lived);

  residentsMeta.textContent = `${residents.length} residents · sorted by what they have lived`;
  residentsTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Resident</th><th>Doing</th>
          <th class="num">Happiness</th><th class="num">Lived</th>
          <th class="num">Credits</th><th class="num">Energy</th><th class="num">Built</th>
          <th>Cares most about</th>
        </tr>
      </thead>
      <tbody>
        ${residents.map((resident) => {
    const owned = buildings.filter((building) => building.proprietorId === resident.id).length;
    const top = Object.entries(resident.preferences ?? {})
      .sort(([, left], [, right]) => right - left).slice(0, 3)
      .map(([dimension]) => dimension).join(", ");
    const livedValue = round1(resident.livedHappiness ?? 0);
    const livedWidth = Math.round((Math.abs(livedValue) / livedScale) * 100);
    const activity = describeActivity(resident.activity, locationById(resident.locationId)?.name ?? resident.locationId);
    return `
          <tr class="${resident.id === state.selectedId ? "selected" : ""}">
            <td><button class="resident-link" data-resident="${escapeHtml(resident.id)}">${escapeHtml(resident.name)}</button></td>
            <td class="doing">${escapeHtml(activity.title)}</td>
            <td class="num"><span class="happiness-chip ${resident.happiness >= 60 ? "good" : resident.happiness <= 35 ? "poor" : ""}">${resident.happiness}</span></td>
            <td class="num">
              <span class="lived ${livedValue < 0 ? "poor" : livedValue > 0 ? "good" : ""}">${signed(livedValue)}</span>
              <span class="lived-track"><span class="lived-fill ${livedValue < 0 ? "poor" : "good"}" style="width:${livedWidth}%"></span></span>
            </td>
            <td class="num">${number(resident.credits)}</td>
            <td class="num">${resident.energy}</td>
            <td class="num">${owned || "—"}</td>
            <td class="cares">${escapeHtml(top)}</td>
          </tr>`;
  }).join("")}
      </tbody>
    </table>`;

  for (const button of residentsTable.querySelectorAll(".resident-link")) {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.resident;
      select.value = state.selectedId;
      renderResidents();
      renderCharacter();
      loadCharacterTimeline();
    });
  }
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
  const seededByCell = new Map(city.seededLocations
    .filter((location) => Number.isInteger(location.x))
    .map((location) => [`${location.x},${location.y}`, location]));
  const residentsByLocation = new Map();
  for (const location of state.world.locations) {
    residentsByLocation.set(location.id, location.population);
  }

  const active = city.buildings.filter((building) => building.status === "ACTIVE").length;
  const rising = city.buildings.filter((building) => building.status === "UNDER_CONSTRUCTION").length;
  cityMeta.textContent = `${city.width}x${city.height} · ${active} built`
    + (rising ? ` · ${rising} rising` : "");

  const cells = [];
  for (let y = 1; y <= city.height; y += 1) {
    for (let x = 1; x <= city.width; x += 1) {
      const key = `${x},${y}`;
      const building = buildingsByCell.get(key);
      const seeded = seededByCell.get(key);
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
      }
      cells.push(`<i class="${className}" title="${escapeHtml(title)}">${escapeHtml(label)}</i>`);
    }
  }
  cityMap.style.setProperty("--columns", city.width);
  cityMap.innerHTML = cells.join("");

  buildingList.innerHTML = city.buildings.length
    ? city.buildings.map((building) => {
      // The profile is what the place actually delivers and what it was priced on, and
      // it is the ceiling on every night hosted there. Showing only the derived tags hid
      // the one number that explains both the cost and who will enjoy it.
      const profile = Object.entries(building.profile ?? {})
        .filter(([, value]) => value > 0)
        .sort(([, left], [, right]) => right - left)
        .map(([dimension, value]) => meter(dimension, value, 100, value >= 70 ? "strong" : ""))
        .join("");
      const live = state.world.events.filter((event) =>
        event.buildingId === building.buildingId && event.status !== "ended");
      const ambition = Object.values(building.profile ?? {}).reduce((sum, value) => sum + value, 0) / 100;
      const net = building.revenue - building.upkeepPaid;
      return `
      <article class="building-card ${building.status.toLowerCase()}">
        <div class="building-topline">
          <div>
            <span class="location-id">${escapeHtml(`${building.x},${building.y}`)} · ${building.width}x${building.height} · ${escapeHtml(building.status.toLowerCase())}</span>
            <h3>${escapeHtml(building.name)}</h3>
          </div>
          <div class="building-capacity"><strong>${building.capacity}</strong><span>capacity</span></div>
        </div>
        <p class="location-caption">${escapeHtml(characterName(building.proprietorId))}${
  live.length ? ` · <span class="live-now">${live.length} on now</span>` : " · nothing on"
}</p>
        ${building.description ? `<p class="building-description">${escapeHtml(building.description)}</p>` : ""}
        <div class="meters compact">${profile}</div>
        <div class="location-signals">
          <span title="ambition is the sum of the profile over 100; cost rises with its square">ambition ${ambition.toFixed(1)}</span>
          <span>built for ${number(building.constructionCost)}</span>
          <span>earned ${number(building.revenue)}</span>
          <span>upkeep paid ${number(building.upkeepPaid)}</span>
          <span class="${net < 0 ? "negative" : "positive"}">net ${signed(net)}</span>
          <span>balance ${number(building.balance)}</span>
          <span>${number(building.dailyUpkeep)}/day upkeep</span>
        </div>
        <p class="routes">Can: ${escapeHtml(building.capabilities.join(" · "))}</p>
        ${building.status === "UNDER_CONSTRUCTION" && building.completesAt
    ? `<p class="routes">Opens at ${escapeHtml(formatTime(building.completesAt))}</p>` : ""}
      </article>`;
    }).join("")
    : `<p class="empty-note">Nobody has built anything yet. A resident claims any free cell and raises a place for ${number(city.cheapestUsefulBuilding)} credits upward, choosing what it delivers.</p>`;
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
  const recent = state.worldTimeline.slice(-60).reverse();
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
  const rules = state.world.rules;
  const relationships = character.importantRelationships.slice(0, 5).map((relationship) => `
    <li>
      <span>${escapeHtml(relationship.name)}</span>
      <span class="relationship ${relationship.affinity < 0 || relationship.trust < 0 ? "negative" : "positive"}" title="Affinity, trust, tension">A ${signed(relationship.affinity)} · Tr ${signed(relationship.trust)} · X ${relationship.tension}</span>
    </li>`).join("");

  // What this resident cares about, strongest first. It is the most explanatory thing
  // on the page: affinity with an evening is computed from exactly these ten numbers,
  // so a good or bad night is readable here before it happens.
  const preferences = Object.entries(character.preferences ?? {})
    .sort(([, left], [, right]) => right - left)
    .map(([dimension, value]) => meter(dimension, value, 100, value >= 70 ? "strong" : value <= 20 ? "faint" : ""))
    .join("");

  const skills = Object.entries(character.skills ?? {})
    .sort(([, left], [, right]) => right - left)
    .map(([skill, value]) => meter(skill, value, 100)).join("");

  const goals = [
    ...(character.primaryGoal ? [{ ...character.primaryGoal, kind: "primary" }] : []),
    ...(character.secondaryGoals ?? []).map((goal) => ({ ...goal, kind: "secondary" })),
  ];
  const goalList = goals.length
    ? goals.map((goal) => `
      <li class="goal-row ${escapeHtml(goal.status ?? "active")}">
        <span class="goal-kind">${escapeHtml(goal.kind)}</span>
        <span class="goal-what">${escapeHtml(String(goal.type ?? "").replace(/_/g, " "))}${goal.targetId ? ` → ${escapeHtml(goal.targetId)}` : ""}</span>
        <span class="goal-status">${escapeHtml(goal.status ?? "active")}</span>
      </li>`).join("")
    : `<li class="goal-row"><span class="goal-what">No active goal</span></li>`;

  const owned = (state.world.city?.buildings ?? []).filter((building) => building.proprietorId === character.id);
  const property = owned.length
    ? owned.map((building) => `
      <li class="owned-row ${escapeHtml(building.status.toLowerCase())}">
        <span>${escapeHtml(building.name)}</span>
        <span class="owned-meta">${escapeHtml(building.status.toLowerCase())} · balance ${number(building.balance)} · earned ${number(building.revenue)}</span>
      </li>`).join("")
    : "";

  const happinessTone = character.happiness >= 60 ? "good" : character.happiness <= 35 ? "poor" : "";
  const livedTone = character.livedHappiness > 0 ? "good" : character.livedHappiness < 0 ? "poor" : "";

  panel.innerHTML = `
    <div class="identity">
      <div class="avatar" aria-hidden="true">${escapeHtml(character.name[0])}</div>
      <div>
        <p class="eyebrow">Resident profile</p>
        <h2>${escapeHtml(character.name)}</h2>
        <div class="traits">${(character.personality ?? []).map((trait) => `<span>${escapeHtml(trait)}</span>`).join("")}</div>
      </div>
    </div>
    <div class="now-card">
      <span class="now-label">Right now</span>
      <strong>${escapeHtml(activity.title)}</strong>
      <span>${escapeHtml(activity.detail)}</span>
      ${character.agentAvailability !== "available"
        ? `<span class="agent-warning">brain ${escapeHtml(character.agentAvailability)} · ${character.consecutiveMissedResponses} missed</span>`
        : ""}
    </div>
    <div class="stats">
      ${stat("Energy", `${character.energy} / ${rules.maximumEnergy}`)}
      ${stat("Credits", number(character.credits))}
      ${stat("Happiness", character.happiness, happinessTone)}
      ${stat("Lived total", signed(round1(character.livedHappiness)), livedTone)}
    </div>
    <div class="stats secondary">
      ${stat("Reputation", character.reputation)}
      ${stat("Score", character.score)}
      ${stat("Buildings", owned.length)}
    </div>
    <div class="goal-block"><span>Long-term objective</span><p>${escapeHtml(character.goal)}</p></div>
    <div class="meter-block">
      <div class="minor-heading"><h3>Cares about</h3><span>affinity is computed from these</span></div>
      <div class="meters">${preferences || "<p class=\"empty-note\">No preferences recorded</p>"}</div>
    </div>
    <div class="meter-block">
      <div class="minor-heading"><h3>Skills</h3><span>gates which work is possible</span></div>
      <div class="meters">${skills}</div>
    </div>
    <div class="relationships">
      <div class="minor-heading"><h3>Goals</h3><span>what it is pursuing</span></div>
      <ul class="goal-list">${goalList}</ul>
    </div>
    ${property ? `
    <div class="relationships">
      <div class="minor-heading"><h3>Property</h3><span>what it built</span></div>
      <ul class="owned-list">${property}</ul>
    </div>` : ""}
    <div class="relationships">
      <div class="minor-heading"><h3>Relationships</h3><span>directional</span></div>
      <ul>${relationships || "<li><span>No relationships yet</span></li>"}</ul>
    </div>`;
}

// A labelled bar. Ten preference rows have to stay readable at a glance, so the label
// and the number sit on one line and the bar carries the comparison.
function meter(label, value, maximum, tone = "") {
  const width = Math.max(0, Math.min(100, (value / maximum) * 100));
  return `
    <div class="meter ${tone}">
      <span class="meter-label">${escapeHtml(label)}</span>
      <span class="meter-track"><span class="meter-fill" style="width:${width}%"></span></span>
      <span class="meter-value">${value}</span>
    </div>`;
}

function round1(value) {
  return Math.round((value ?? 0) * 10) / 10;
}

async function loadCharacterTimeline() {
  if (!state.selectedId) return;
  const response = await fetch(`/api/timeline?characterId=${encodeURIComponent(state.selectedId)}`);
  if (!response.ok) return;
  const data = await response.json();
  eventCount.textContent = `${data.items.length} meaningful events`;
  // Newest first. A life read oldest-first means scrolling to the bottom to find out
  // what just happened, which is the one thing an observer always wants.
  timeline.replaceChildren(...[...data.items].reverse().map((item, index) => {
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
function stat(label, value, tone = "") { return `<div class="stat ${tone}"><span>${label}</span><strong>${value}</strong></div>`; }
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

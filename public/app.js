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
const courseList = document.querySelector("#course-list");
const courseMeta = document.querySelector("#course-meta");
const boardSummary = document.querySelector("#board-summary");
const eventList = document.querySelector("#event-list");
const eventMeta = document.querySelector("#event-meta");
const economyOverview = document.querySelector("#economy-overview");
const worldActivity = document.querySelector("#world-activity");
const worldEventCount = document.querySelector("#world-event-count");
const cityMap = document.querySelector("#city-map");
const cityMeta = document.querySelector("#city-meta");
const buildingList = document.querySelector("#building-list");
const residentsRoster = document.querySelector("#residents-roster");
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
const parameterGroups = document.querySelector("#parameter-groups");
const parametersMeta = document.querySelector("#parameters-meta");
const actionGroups = document.querySelector("#action-groups");
const actionsMeta = document.querySelector("#actions-meta");

// Pages rather than one long scroll. The hash carries the page so a reload, or a link
// sent to someone else, lands where it was.
const pages = ["overview", "residents", "city", "economy", "parameters", "actions", "health"];

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
  if (!tab) return;
  showPage(tab.dataset.page);
  // Opening a page is the moment its numbers should be current, so navigation re-renders
  // from the freshest fetched state - the one moment a redraw cannot yank anything the
  // reader was holding open.
  if (state.world) renderAll();
});
window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));
showPage(location.hash.slice(1));

select.addEventListener("change", () => {
  state.selectedId = select.value;
  renderCharacter();
  loadCharacterTimeline();
});

await fullRefresh();
setInterval(liveRefresh, 5_000);

async function loadData() {
  const [stateResponse, timelineResponse] = await Promise.all([
    fetch("/api/state"),
    fetch("/api/timeline"),
  ]);
  if (!stateResponse.ok || !timelineResponse.ok) throw new Error("The world is temporarily unavailable.");
  state.world = await stateResponse.json();
  state.worldTimeline = (await timelineResponse.json()).items;
  state.selectedId ??= state.world.characters[0]?.id;
  worldTime.textContent = formatWorldTime(state.world.worldTime);
}

async function fullRefresh() {
  try {
    await loadData();
    renderAll();
    await loadCharacterTimeline();
  } catch (error) {
    panel.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    worldSummary.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

// The 5-second tick feeds only what streams: the clock, the two timelines, and the health
// badge. It used to re-render every panel, which slammed shut whatever the reader had open
// - the wallet ledger closed itself mid-read every five seconds. Panels re-render on the
// reader's own actions instead: load, tab change, resident selection.
async function liveRefresh() {
  try {
    await loadData();
    renderWorldActivity();
    updateHealthBadge();
    await loadCharacterTimeline();
  } catch {
    worldTime.textContent = "world unreachable";
  }
}

function renderAll() {
  renderPicker();
  renderWorldOverview();
  renderCharacter();
  renderWorldActivity();
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
  renderCourses();
  renderEvents();
  renderEconomy();
  renderStandings();
  renderResidents();
  renderCity();
  renderParameters();
  renderActions();
  renderHealth();
}

// Everything an agent can submit, with its parameters, grouped as the server declares it.
// Rendered generically from the shipped catalog - the same one a test pins against the
// real dispatch - so a new action appears here without anyone remembering the observer.
function renderActions() {
  const groups = state.world.agentActions;
  if (!groups) {
    actionsMeta.textContent = "not shipped by this server";
    actionGroups.innerHTML = `<p class="empty-note">This server predates the action catalog; restart it to see what agents can do.</p>`;
    return;
  }
  const total = groups.reduce((count, group) => count + group.actions.length, 0);
  actionsMeta.textContent = `${total} actions in ${groups.length} groups · read-only`;
  actionGroups.innerHTML = groups.map((group) => `
    <article class="parameter-group">
      <h3>${escapeHtml(group.group)}</h3>
      ${group.actions.map((action) => `
        <div class="action-entry">
          <h4><code>${escapeHtml(action.name)}</code></h4>
          <p>${escapeHtml(action.summary)}</p>
          ${action.parameters.length ? `<dl class="parameter-list">${action.parameters.map((parameter) => `
            <div class="parameter-row">
              <dt>${escapeHtml(parameter.name)}<i class="param-required ${parameter.required === true ? "yes" : parameter.required === "conditional" ? "cond" : ""}">${parameter.required === true ? "required" : parameter.required === "conditional" ? "conditional" : "optional"}</i></dt>
              <dd>${escapeHtml(parameter.description)}</dd>
            </div>`).join("")}</dl>` : `<p class="empty-note">No parameters.</p>`}
        </div>`).join("")}
    </article>`).join("");
}

// The whole tuning surface, read-only, grouped by domain exactly as the server declares
// it: finding the balance is a matter of playing with parameters, and an operator cannot
// play with numbers it cannot see. Rendered generically so a parameter added to config
// appears here without anyone remembering to.
function renderParameters() {
  const parameters = state.world.parameters;
  if (!parameters) {
    parametersMeta.textContent = "not shipped by this server";
    parameterGroups.innerHTML = `<p class="empty-note">This server predates the parameters endpoint; restart it to see the tuning surface.</p>`;
    return;
  }
  const groups = Object.entries(parameters);
  parametersMeta.textContent = `${groups.length} domains · read-only · world configuration ${state.world.worldConfigurationVersion ?? "—"}`;
  parameterGroups.innerHTML = groups.map(([domain, values]) => `
    <article class="parameter-group">
      <h3>${escapeHtml(domain)}</h3>
      <dl class="parameter-list">${parameterRows(values)}</dl>
    </article>`).join("");
}

function parameterRows(value, prefix = "") {
  return Object.entries(value).map(([key, entry]) => {
    const label = prefix ? `${prefix}.${key}` : key;
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      return parameterRows(entry, label);
    }
    return `<div class="parameter-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(parameterValue(entry))}</dd>
    </div>`;
  }).join("");
}

function parameterValue(entry) {
  if (entry === null) return "—";
  if (Array.isArray(entry)) {
    return entry.every((item) => typeof item !== "object" || item === null)
      ? entry.map((item) => String(item ?? "—")).join(", ")
      // Catalogs and bands: one compact line per entry, every field visible.
      : entry.map((item) => Object.entries(item)
        .map(([field, fieldValue]) => `${field} ${fieldValue === null ? "—" : fieldValue}`).join(" · "))
        .join("  |  ");
  }
  return String(entry);
}

// A run once ran for two hours while four of seven brains had stopped answering. The
// world kept ticking, events kept flowing, and nothing on this dashboard said so. A
// resident whose brain is not answering is not a quiet resident, it is a stopped one.
function updateHealthBadge() {
  const stopped = state.world.characters.filter((resident) => resident.agentAvailability !== "available");
  healthBadge.textContent = stopped.length ? String(stopped.length) : "";
  healthBadge.className = `tab-badge ${stopped.length ? "alert" : ""}`;
}

function renderHealth() {
  const residents = state.world.characters;
  const runtime = state.world.runtime ?? { connectedAgentBrains: 0, eventStreamConnections: 0 };
  const rules = state.world.rules;
  const stopped = residents.filter((resident) => resident.agentAvailability !== "available");
  const struggling = residents.filter((resident) =>
    resident.agentAvailability === "available" && (resident.consecutiveMissedResponses ?? 0) > 0);

  updateHealthBadge();

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
      key: "relationships",
      label: "Relationships",
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
// observer actually opens the page with. One card per life, not one row per record:
// the eight-column table read as a spreadsheet, and the two numbers that tell a life
// apart - what it has lived and what it can still spend - drowned between the others.
function renderResidents() {
  const residents = [...state.world.characters]
    .sort((left, right) => right.livedHappiness - left.livedHappiness);
  const buildings = state.world.city?.buildings ?? [];

  residentsMeta.textContent = `${residents.length} residents · sorted by what they have lived`;
  residentsRoster.innerHTML = residents.map((resident) => {
    const location = locationById(resident.locationId)?.name ?? resident.locationId ?? "nowhere yet";
    const activity = describeActivity(resident.activity, location);
    const down = resident.agentAvailability !== "available";
    const owned = buildings.filter((building) => building.proprietorId === resident.id).length;
    const livedValue = round1(resident.livedHappiness ?? 0);
    const bestDomain = Object.entries(resident.domainReputation ?? {})
      .sort(([, left], [, right]) => right - left)[0];
    const topSkills = Object.entries(resident.skills ?? {})
      .sort(([, left], [, right]) => right - left).slice(0, 2);
    return `
      <button class="resident-card ${resident.id === state.selectedId ? "selected" : ""} ${down ? "brain-down" : ""}"
        data-resident="${escapeHtml(resident.id)}">
        <div class="resident-card-top">
          <span class="avatar" aria-hidden="true">${escapeHtml(resident.name[0])}</span>
          <span class="resident-card-name">
            <strong>${escapeHtml(resident.name)}</strong>
            <small>${escapeHtml(activity.title)} · ${escapeHtml(location)}</small>
          </span>
          <i class="presence-dot ${down ? "down" : "up"}" title="${down ? `brain ${escapeHtml(resident.agentAvailability)}` : "brain answering"}"></i>
        </div>
        <div class="resident-card-figures">
          <span class="figure"><small>lived</small><strong class="${livedValue < 0 ? "poor" : livedValue > 0 ? "good" : ""}">${signed(livedValue)}</strong></span>
          <span class="figure"><small>credits</small><strong>${number(resident.credits)}</strong></span>
          <span class="figure"><small>happiness</small><strong><span class="happiness-chip ${resident.happiness >= 60 ? "good" : resident.happiness <= 35 ? "poor" : ""}">${resident.happiness}</span></strong></span>
          <span class="figure"><small>reputation</small><strong>${round1(resident.reputation)}</strong></span>
        </div>
        <div class="resident-card-energy" title="energy ${resident.energy} / ${state.world.rules.maximumEnergy}">
          <span class="meter-track"><span class="meter-fill ${fillClass(resident.energy, state.world.rules.maximumEnergy)}"></span></span>
          <small>${resident.energy}</small>
        </div>
        <div class="resident-card-tags">
          ${(resident.garage ?? []).map((vehicle) => `<span class="built">${escapeHtml(vehicle.id)}</span>`).join("")}
          ${topSkills.map(([skill, value]) => `<span>${escapeHtml(skill)} ${value}</span>`).join("")}
          ${bestDomain && bestDomain[1] > 0 ? `<span class="proven">${escapeHtml(bestDomain[0])} reputation ${round1(bestDomain[1])}</span>` : ""}
          ${owned ? `<span class="built">${plural(owned, "building")}</span>` : ""}
        </div>
      </button>`;
  }).join("");

  for (const card of residentsRoster.querySelectorAll(".resident-card")) {
    card.addEventListener("click", () => {
      state.selectedId = card.dataset.resident;
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
        <p class="location-caption">${escapeHtml(characterName(building.proprietorId))} · ${
  building.open
    ? `<span class="live-now">open${live.length ? ` · ${live.length} on now` : ""}</span>`
    : `<span class="shut">closed${building.opensAt ? ` · opens ${escapeHtml(formatTime(building.opensAt))} for ${escapeHtml(building.nextEventTitle ?? "")}` : " · nothing programmed"}</span>`
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
        ${(() => {
    // A venue that earns and never hires is a venue whose money stops moving. Showing the
    // roles it has open makes the difference between takings and a wage bill visible.
    const roles = state.world.jobs.filter((job) => job.fundingSourceType === "building"
      && job.fundingSourceId === building.buildingId
      && !["completed", "failed", "cancelled", "expired"].includes(job.status));
    if (roles.length === 0) return "";
    return `<ul class="building-roles">${roles.map((role) => {
      const staff = (role.workerIds ?? []).map(characterById).filter(Boolean);
      const applicants = role.status === "open" && role.hiring === "application"
        ? ` · ${plural(role.applicationCount ?? 0, "applicant")}` : "";
      return `<li><span class="role-title">${escapeHtml(role.title)}</span>
        <span class="role-wage">${number(role.compensation)} cr</span>
        <span class="role-who">${staff.length ? escapeHtml(staff.map((person) => person.name).join(", ")) : `unfilled${applicants}`}</span></li>`;
    }).join("")}</ul>`;
  })()}
        ${(() => {
    // Tuition is the building's second income after admission, so a place that teaches
    // should say so where its takings are explained.
    const taught = (state.world.courses ?? []).filter((course) =>
      course.buildingId === building.buildingId && course.status === "open");
    if (taught.length === 0) return "";
    return `<ul class="building-roles">${taught.map((course) => `
      <li><span class="role-title">${escapeHtml(course.title)}</span>
        <span class="role-wage">${number(course.price)} cr tuition</span>
        <span class="role-who">teaches ${escapeHtml(humanize(course.skill))} · ${course.completedCount ?? 0} completed</span></li>`).join("")}</ul>`;
  })()}
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

function buildingById(buildingId) {
  return state.world.city?.buildings.find((building) => building.buildingId === buildingId) ?? null;
}

function renderJobs() {
  const statuses = countBy(state.world.jobs, (job) => job.status);
  jobMeta.textContent = `${statuses.open ?? 0} open · ${statuses.running ?? 0} running · ${statuses.completed ?? 0} completed`;
  // Work lives on a board in a square, and a resident reads only the board it is standing
  // at. Grouping the open notices by square shows the market the way the residents meet it:
  // four separate boards, not one city-wide list.
  const squares = state.world.locations.filter((location) => !location.buildingId);
  boardSummary.innerHTML = squares.map((square) => {
    const open = state.world.jobs.filter((job) => job.status === "open"
      && (job.boardLocationId ?? job.locationId) === square.id).length;
    const coursesHere = (state.world.courses ?? []).filter((course) => course.status === "open"
      && course.boardLocationId === square.id).length;
    const here = state.world.characters.filter((person) => person.locationId === square.id).length;
    return `<div class="board-tile${open === 0 ? " empty" : ""}">
      <span class="board-name">${escapeHtml(square.name)}</span>
      <strong>${open}</strong><span class="board-unit">open</span>
      <span class="board-here">${here} here${coursesHere ? ` · ${plural(coursesHere, "course")}` : ""}</span>
    </div>`;
  }).join("");
  const statusOrder = { running: 0, accepted: 1, open: 2, completed: 3, cancelled: 4, failed: 5, expired: 6 };
  const jobs = [...state.world.jobs].sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));
  jobList.innerHTML = jobs.length ? jobs.map((job) => {
    const location = locationById(job.locationId);
    const workers = (job.workerIds ?? [job.workerId]).map(characterById).filter(Boolean);
    // Skill demands and reputation demands read as one bar to clear, because to a
    // candidate they are: both decide whether the application is even accepted.
    const requirements = [
      ...Object.entries(job.requirements ?? {}).filter(([, value]) => value > 0)
        .map(([skill, value]) => `${humanize(skill)} ${value}+`),
      ...Object.entries(job.reputationRequirements ?? {}).filter(([, value]) => value > 0)
        .map(([domain, value]) => `${humanize(domain)} reputation ${value}+`),
    ];
    // A resident-funded role hangs on a public square and is worked somewhere else, so the
    // two places have to be told apart. A city post is read where it is done.
    const board = locationById(job.boardLocationId ?? job.locationId);
    const employer = job.fundingSourceType === "building"
      ? buildingById(job.fundingSourceId)
      : null;
    const advertised = (job.boardLocationId ?? job.locationId) !== job.locationId;
    return `
      <article class="job-row${employer ? " employed" : ""}">
        <div class="job-primary">
          <div class="job-title-line">
            <span class="status-badge status-${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
            ${employer ? `<span class="employer-badge">${escapeHtml(employer.name)}</span>` : ""}
            <h3>${escapeHtml(job.title)}</h3>
          </div>
          <p>${advertised
    ? `posted at <strong>${escapeHtml(board?.name ?? job.boardLocationId)}</strong> · worked at ${escapeHtml(location?.name ?? job.locationId)}`
    : escapeHtml(location?.name ?? job.locationId)
}${workers.length ? ` · ${job.teamSize > 1 ? "team" : "assigned to"} <strong>${workers.map((worker) => escapeHtml(worker.name)).join(", ")}</strong>` : " · unassigned"}</p>
        </div>
        <dl class="job-facts">
          <div><dt>Pay</dt><dd>${number(job.compensation)} cr</dd></div>
          <div><dt>Duration</dt><dd>${formatDuration(job.durationGameMinutes)}</dd></div>
          <div><dt>Energy</dt><dd>${job.energyCost} / ${state.world.rules.maximumEnergy}</dd></div>
          <div><dt>Requirements</dt><dd>${requirements.length ? requirements.join(", ") : "None"}</dd></div>
          <div><dt>Paid by</dt><dd>${employer ? `${escapeHtml(employer.name)}'s takings` : "the city budget"}</dd></div>
          ${job.hiring === "application"
    ? `<div><dt>Hiring</dt><dd>by application · ${job.status === "open" ? plural(job.applicationCount ?? 0, "applicant") : "selected"}</dd></div>` : ""}
          ${job.teamSize > 1 ? `<div><dt>Team</dt><dd>${workers.length} / ${job.teamSize} · collective coverage</dd></div>` : ""}
        </dl>
        <div class="job-window">
          <span>Starts ${formatDateTime(job.scheduledStartAt)}</span>
          <span>Offer closes ${formatDateTime(job.offerExpiresAt)}</span>
        </div>
      </article>`;
  }).join("") : `<p class="empty-state">No jobs exist in this world.</p>`;
}

// AIT-1205. The learning market beside the job market, because they compete for the same
// day: a course is the priced way into a skill no reachable post teaches, and the observer
// should be able to see whether anyone is actually buying one.
function renderCourses() {
  const courses = state.world.courses ?? [];
  const open = courses.filter((course) => course.status === "open");
  const completed = courses.reduce((total, course) => total + (course.completedCount ?? 0), 0);
  const enrolled = courses.reduce((total, course) => total + (course.enrollmentCount ?? 0), 0);
  courseMeta.textContent = `${open.length} on offer · ${enrolled} enrolments · ${completed} completed`;
  courseList.innerHTML = courses.length ? courses.map((course) => {
    const board = locationById(course.boardLocationId);
    const building = course.buildingId ? buildingById(course.buildingId) : null;
    const provider = building
      ? `${building.name} (${characterName(course.providerId)})`
      : "the city";
    const prerequisites = Object.entries(course.prerequisites ?? {})
      .map(([skill, minimum]) => `${humanize(skill)} ${minimum}+`);
    const effect = `${humanize(course.skill)} +${course.gain} up to ${course.teachesTo}`
      + (course.tradeoffSkill ? ` · ${humanize(course.tradeoffSkill)} −${course.tradeoffLoss}` : "");
    const abandoned = course.abandonedCount ?? 0;
    return `
      <article class="job-row${building ? " employed" : ""}">
        <div class="job-primary">
          <div class="job-title-line">
            <span class="status-badge status-${escapeHtml(course.status)}">${escapeHtml(course.status)}</span>
            ${building ? `<span class="employer-badge">${escapeHtml(building.name)}</span>` : ""}
            <h3>${escapeHtml(course.title)}</h3>
          </div>
          <p>posted at <strong>${escapeHtml(board?.name ?? course.boardLocationId)}</strong>${
  building ? ` · taught at ${escapeHtml(building.name)}` : ""} · by ${escapeHtml(provider)}</p>
        </div>
        <dl class="job-facts">
          <div><dt>Teaches</dt><dd>${escapeHtml(effect)}</dd></div>
          <div><dt>Tuition</dt><dd>${number(course.price)} cr · no refund</dd></div>
          <div><dt>Duration</dt><dd>${formatDuration(course.durationGameMinutes)}</dd></div>
          <div><dt>Energy</dt><dd>${course.energyCost} / ${state.world.rules.maximumEnergy}</dd></div>
          <div><dt>Prerequisites</dt><dd>${prerequisites.length ? prerequisites.join(", ") : "None"}</dd></div>
          <div><dt>Taken</dt><dd>${plural(course.enrollmentCount ?? 0, "enrolment")} · ${course.completedCount ?? 0} completed${abandoned ? ` · ${abandoned} forfeited` : ""}</dd></div>
        </dl>
      </article>`;
  }).join("") : `<p class="empty-state">No courses are on offer.</p>`;
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
  // Four pots and one supply. Three figures used to sit side by side with no total, so a
  // reader added them, got more than the bootstrap budget, and reasonably concluded the books
  // were wrong. They were not: escrow is held OUT of the budget, and the residents' opening
  // purses are a second issuance that never touched it. Saying the supply and showing the
  // identity is the difference between three numbers and a balance sheet.
  // With an unlimited treasury a remaining balance is not a fact about anything: what the
  // city has PUT IN is the figure that says whether the economy is running.
  const held = overview.characterCredits + overview.buildingCredits + overview.reservedCredits
    + (overview.cityUnlimited ? 0 : overview.systemBudgetBalance);
  economyOverview.innerHTML = `
    <div class="supply-line ${held === overview.moneySupply ? "balanced" : "broken"}">
      <span>Money supply</span>
      <strong>${number(overview.moneySupply)}</strong>
      <small>${number(overview.issuedToCharacters)} to residents at the start + ${number(overview.cityInjected)} paid in by the city for work done${
  overview.creditsRetired ? `, less ${number(overview.creditsRetired)} spent into buildings and upkeep` : ""
}${held === overview.moneySupply ? "" : ` · only ${number(held)} accounted for`}</small>
    </div>
    <div class="economy-numbers">
      ${economyMetric("Resident wallets", overview.characterCredits, "in their purses")}
      ${economyMetric("Building takings", overview.buildingCredits, "earned by venues")}
      ${economyMetric("Reserved escrow", overview.reservedCredits, "securing open posts")}
      ${overview.cityUnlimited
    ? economyMetric("City injected", overview.cityInjected, "paid for work · unlimited")
    : economyMetric("Unspent budget", overview.systemBudgetBalance, "left to fund work")}
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

  // Skills used to be fixed, so a number was the whole story. Now work teaches, and what
  // this resident has learned is more interesting than where it happens to stand.
  const learned = character.skillsLearned ?? {};
  const skills = Object.entries(character.skills ?? {})
    .sort(([, left], [, right]) => right - left)
    .map(([skill, value]) => meter(skill, value, 100, learned[skill] ? "grown" : "",
      learned[skill] ? `+${learned[skill]}` : null)).join("");

  // AIT-1202: reputation beside the skills it was earned in. Every domain renders, zeros
  // included, because "trained but unproven" is a reading this panel exists to allow: a
  // resident can hold skill 50 and reputation 0 in the same column, and hiding the zero
  // made that look like a missing row instead of a missing record. Values are public;
  // the causes are this resident's own, newest first, and open on request like the wallet.
  // The full taxonomy from the server when it ships it, so even a domain nobody in this
  // world has touched (fitness) renders at zero rather than reading as nonexistent.
  const domainNames = [...new Set([
    ...(state.world.rules.reputationDomains ?? []),
    ...Object.keys(character.skills ?? {}),
    ...Object.keys(character.domainReputation ?? {}),
  ])];
  const domainReputation = domainNames
    .map((domain) => [domain, character.domainReputation?.[domain] ?? 0])
    .sort(([, left], [, right]) => right - left)
    .map(([domain, value]) => meter(domain, round1(value), 100,
      value >= 30 ? "grown" : value === 0 ? "faint" : ""))
    .join("");
  const reputationCauses = (character.reputationLog ?? []).slice(0, 10);
  const reputationLedger = reputationCauses.length
    ? `<details class="wallet-details" data-keep="reputation">
        <summary>${plural(reputationCauses.length, "recent cause")}</summary>
        <ol class="wallet-ledger">${reputationCauses.map((entry) => `
          <li class="wallet-row ${entry.delta > 0 ? "in" : "out"}">
            <span class="wallet-amount">${entry.delta > 0 ? "+" : "−"}${number(Math.abs(entry.delta))}</span>
            <span class="wallet-reason">${escapeHtml(humanize(entry.cause))}${entry.domain ? ` · ${escapeHtml(entry.domain)}` : ""}</span>
            <span class="wallet-balance">${number(entry.value)}</span>
            <span class="wallet-when">${escapeHtml(formatTime(entry.at))}</span>
          </li>`).join("")}</ol>
      </details>`
    : "";

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
        ${goal.guidance ? `<span class="goal-why">${escapeHtml(goal.guidance)}</span>` : ""}
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

  // A redraw must never close what the reader opened: remember which disclosures were
  // open and reopen them after the panel is rebuilt.
  const openDisclosures = new Set([...panel.querySelectorAll("details[data-keep][open]")]
    .map((disclosure) => disclosure.dataset.keep));

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
      ${stat("Lived", signed(round1(character.livedHappiness)), livedTone)}
    </div>
    <div class="stats secondary">
      ${stat("Reputation", round1(character.reputation))}
      ${stat("Garage", (character.garage ?? []).map((vehicle) => vehicle.id).join(", ") || "—")}
      ${stat("Buildings", owned.length)}
    </div>
    <div class="goal-block"><span>Goal</span><p>${escapeHtml(character.goal)}</p></div>
    <div class="meter-block">
      <div class="minor-heading"><h3>Cares about</h3><span>affinity is computed from these</span></div>
      <div class="meters">${preferences || "<p class=\"empty-note\">No preferences recorded</p>"}</div>
    </div>
    <div class="meter-block">
      <div class="minor-heading"><h3>Skills</h3><span>gates which work is possible</span></div>
      <div class="meters">${skills}</div>
    </div>
    <div class="meter-block">
      <div class="minor-heading"><h3>Reputation</h3><span>public · moves only on verified outcomes</span></div>
      <div class="meters">${meter("general", round1(character.reputation), 100, character.reputation >= 30 ? "grown" : "")}${domainReputation}</div>
      ${reputationLedger}
    </div>
    <div class="wallet-block">
      <div class="minor-heading"><h3>Wallet</h3><span>balances at a glance, the ledger on request</span></div>
      ${wallet(character)}
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

  for (const disclosure of panel.querySelectorAll("details[data-keep]")) {
    if (openDisclosures.has(disclosure.dataset.keep)) disclosure.open = true;
  }
}

// A labelled bar. Ten preference rows have to stay readable at a glance, so the label
// and the number sit on one line and the bar carries the comparison.
// The page's own Content-Security-Policy is style-src 'self', which blocks inline style
// attributes - so every meter bar in the observer rendered at zero width and nothing said
// so except a console error nobody was reading. Widths are carried as data attributes and
// applied from script, which the policy allows.
// The page's own Content-Security-Policy is style-src 'self', which blocks an inline style
// attribute AND a style mutation from script. Every bar in the observer therefore rendered at
// zero width, and the city map lost its column count, with nothing to show for it but console
// errors nobody was reading. Widths are a class in five-point steps instead: invisible on a
// bar, and it keeps the header strict rather than adding 'unsafe-inline' to make one CSS
// property work.
function fillClass(value, maximum) {
  const percent = Math.max(0, Math.min(100, (value / maximum) * 100));
  return `fill-${Math.round(percent / 5) * 5}`;
}

// A balance on its own says nothing about how it was reached. The totals reconcile against
// the balance, and the entries say what each movement was and what it left behind.
function wallet(character) {
  const purse = character.wallet ?? { opening: 0, earned: 0, spent: 0, entries: [] };
  const rows = purse.entries.length
    ? purse.entries.map((entry) => `
      <li class="wallet-row ${entry.amount > 0 ? "in" : "out"}">
        <span class="wallet-amount">${entry.amount > 0 ? "+" : "−"}${number(Math.abs(entry.amount))}</span>
        <span class="wallet-reason">${escapeHtml(humanize(entry.reason))}</span>
        <span class="wallet-balance">${number(entry.balance)}</span>
        <span class="wallet-when">${escapeHtml(formatTime(entry.at))}</span>
      </li>`).join("")
    : `<li class="wallet-row empty"><span>Nothing has moved yet.</span></li>`;
  return `
    <div class="wallet-totals">
      <div><span>Opened with</span><strong>${number(purse.opening)}</strong></div>
      <div class="in"><span>Earned</span><strong>+${number(purse.earned)}</strong></div>
      <div class="out"><span>Spent</span><strong>−${number(purse.spent)}</strong></div>
      <div class="balance"><span>Balance</span><strong>${number(character.credits)}</strong></div>
    </div>
    <details class="wallet-details" data-keep="wallet">
      <summary>${purse.entries.length} movement${purse.entries.length === 1 ? "" : "s"}</summary>
      <ol class="wallet-ledger">${rows}</ol>
    </details>`;
}

function meter(label, value, maximum, tone = "", gained = null) {
  return `
    <div class="meter ${tone}">
      <span class="meter-label">${escapeHtml(label)}</span>
      <span class="meter-track"><span class="meter-fill ${fillClass(value, maximum)}"></span></span>
      <span class="meter-value">${value}${gained ? `<i class="meter-gain">${escapeHtml(gained)}</i>` : ""}</span>
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
  if (activity.type === "course") return { title: activity.title, detail: `In class at ${location} until ${formatTime(activity.expectedEndAt)}` };
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
function isTurningPoint(type) { return ["AGENT_NOTIFICATION_QUEUED", "KNOWLEDGE_LEARNED", "RELATIONSHIP_CHANGED", "DECISION_RECORDED", "COURSE_COMPLETED", "BUILDING_ROLE_FILLED"].includes(type); }
function activityCategory(type) {
  if (type.startsWith("JOB_") || type.startsWith("COURSE_") || type.startsWith("BUILDING_ROLE_")) return "job";
  if (type.startsWith("CONVERSATION_") || type.startsWith("RELATIONSHIP_") || type.includes("REPUTATION_")) return "social";
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

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const backlogDirectory = path.join(repositoryRoot, "docs", "product-backlog");
const epicDirectory = path.join(backlogDirectory, "epics");
const errors = [];

function fail(message) {
  errors.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

const epicFiles = fs
  .readdirSync(epicDirectory)
  .filter((name) => /^E\d{2}-.+\.md$/.test(name))
  .sort();

const epics = new Map();
const stories = new Map();
const specificationUpdated = new Set();

for (const epicFile of epicFiles) {
  const relativePath = path.join("docs", "product-backlog", "epics", epicFile);
  const content = read(relativePath);
  const titleMatch = content.match(/^# (E\d{2}) — (.+)$/m);
  const statusMatch = content.match(/^\*\*Status:\*\* (Done|In progress|To do)$/m);

  if (!titleMatch || !statusMatch) {
    fail(`${relativePath}: missing canonical epic title or status.`);
    continue;
  }

  const [, epicId, epicTitle] = titleMatch;
  const epicNumber = Number(epicId.slice(1));
  const headingMatches = [...content.matchAll(/^### (AIT-(\d+)) — (.+)$/gm)];
  const epicStories = [];

  for (let index = 0; index < headingMatches.length; index += 1) {
    const heading = headingMatches[index];
    const nextHeading = headingMatches[index + 1];
    const section = content.slice(
      heading.index,
      nextHeading ? nextHeading.index : content.length,
    );
    const storyId = heading[1];
    const numericId = Number(heading[2]);
    const metadata = section.match(
      /\*\*Priority:\*\* ([^·\r\n]+?) · \*\*Increment:\*\* ([^·\r\n]+?) · \*\*Status:\*\* (Done|In progress|To do)/,
    );

    if (!metadata) {
      fail(`${relativePath}: ${storyId} has no canonical Priority/Increment/Status line.`);
      continue;
    }
    if (stories.has(storyId)) {
      fail(`${storyId} is duplicated in ${relativePath} and ${stories.get(storyId).path}.`);
      continue;
    }
    if (Math.floor(numericId / 100) !== epicNumber) {
      fail(`${relativePath}: ${storyId} does not belong to ${epicId}.`);
    }

    const story = {
      id: storyId,
      title: heading[3].trim(),
      priority: metadata[1].trim(),
      increment: metadata[2].trim(),
      status: metadata[3],
      path: relativePath,
      dependencies: section.match(/\*\*Dependencies:\*\* ([^\r\n]+)/)?.[1].match(/AIT-\d+/g) ?? [],
    };
    stories.set(storyId, story);
    epicStories.push(story);

    if (section.includes("**Specification:** Updated (2026-08-18)")) {
      specificationUpdated.add(storyId);
    }
  }

  const storyStatuses = epicStories.map((story) => story.status);
  const derivedStatus = storyStatuses.every((status) => status === "Done")
    ? "Done"
    : storyStatuses.every((status) => status === "To do")
      ? "To do"
      : "In progress";

  if (statusMatch[1] !== derivedStatus) {
    fail(`${relativePath}: epic status is ${statusMatch[1]}, expected ${derivedStatus}.`);
  }

  epics.set(epicId, {
    id: epicId,
    title: epicTitle.trim(),
    status: statusMatch[1],
    path: relativePath.replaceAll("\\", "/"),
    stories: epicStories,
  });
}

const expectedEpicIds = Array.from({ length: 17 }, (_, index) => `E${String(index).padStart(2, "0")}`);
if (JSON.stringify([...epics.keys()]) !== JSON.stringify(expectedEpicIds)) {
  fail(`Epic inventory must be contiguous E00–E16; found ${[...epics.keys()].join(", ")}.`);
}

for (const story of stories.values()) {
  for (const dependency of story.dependencies) {
    if (!stories.has(dependency)) fail(`${story.id} depends on unknown ${dependency}.`);
    if (dependency === story.id) fail(`${story.id} depends on itself.`);
  }
}

const visitState = new Map();
const dependencyStack = [];
function visitDependencies(storyId) {
  if (visitState.get(storyId) === "done") return;
  if (visitState.get(storyId) === "visiting") {
    const cycleStart = dependencyStack.indexOf(storyId);
    fail(`Dependency cycle: ${[...dependencyStack.slice(cycleStart), storyId].join(" -> ")}.`);
    return;
  }
  visitState.set(storyId, "visiting");
  dependencyStack.push(storyId);
  for (const dependency of stories.get(storyId)?.dependencies ?? []) {
    if (stories.has(dependency)) visitDependencies(dependency);
  }
  dependencyStack.pop();
  visitState.set(storyId, "done");
}
for (const storyId of stories.keys()) visitDependencies(storyId);

const backlogReadme = read("docs/product-backlog/README.md");
const readmeEpicRows = [...backlogReadme.matchAll(
  /^\| (E\d{2}) \| \[([^\]]+)\]\((epics\/[^)]+)\) \| ([^|]+) \| (Done|In progress|To do) \|$/gm,
)];
const indexedEpics = new Set();

for (const row of readmeEpicRows) {
  const [, epicId, title, linkedPath, , status] = row;
  const epic = epics.get(epicId);
  indexedEpics.add(epicId);
  if (!epic) {
    fail(`README indexes unknown epic ${epicId}.`);
    continue;
  }
  if (title !== epic.title) {
    fail(`README title for ${epicId} is "${title}", expected "${epic.title}".`);
  }
  if (`docs/product-backlog/${linkedPath}` !== epic.path) {
    fail(`README link for ${epicId} points to ${linkedPath}, expected ${epic.path}.`);
  }
  if (status !== epic.status) {
    fail(`README status for ${epicId} is ${status}, expected ${epic.status}.`);
  }
}

for (const epicId of epics.keys()) {
  if (!indexedEpics.has(epicId)) {
    fail(`README does not index ${epicId}.`);
  }
}

const implementationStatus = read("docs/product-backlog/IMPLEMENTATION-STATUS.md");
const implementationRows = [...implementationStatus.matchAll(
  /^\| (E\d{2}) — ([^|]+) \| (\d+) \| (\d+) \| (\d+) \| (Done|In progress|To do) \|$/gm,
)];
const implementationEpicIds = new Set();

for (const row of implementationRows) {
  const [, epicId, rawTitle, doneText, progressText, todoText, status] = row;
  const epic = epics.get(epicId);
  implementationEpicIds.add(epicId);
  if (!epic) {
    fail(`IMPLEMENTATION-STATUS indexes unknown epic ${epicId}.`);
    continue;
  }
  const counts = { Done: 0, "In progress": 0, "To do": 0 };
  for (const story of epic.stories) counts[story.status] += 1;
  if (rawTitle.trim() !== epic.title) {
    fail(`IMPLEMENTATION-STATUS title for ${epicId} does not match its epic title.`);
  }
  if (
    Number(doneText) !== counts.Done
    || Number(progressText) !== counts["In progress"]
    || Number(todoText) !== counts["To do"]
  ) {
    fail(`IMPLEMENTATION-STATUS counts for ${epicId} do not match its stories.`);
  }
  if (status !== epic.status) {
    fail(`IMPLEMENTATION-STATUS status for ${epicId} is ${status}, expected ${epic.status}.`);
  }
}

for (const epicId of epics.keys()) {
  if (!implementationEpicIds.has(epicId)) {
    fail(`IMPLEMENTATION-STATUS does not index ${epicId}.`);
  }
}

const globalCounts = { Done: 0, "In progress": 0, "To do": 0 };
for (const story of stories.values()) globalCounts[story.status] += 1;
const snapshotMatch = implementationStatus.match(
  /^\| Full product backlog \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/m,
);
if (!snapshotMatch) {
  fail("IMPLEMENTATION-STATUS has no full-backlog snapshot row.");
} else if (
  Number(snapshotMatch[1]) !== globalCounts.Done
  || Number(snapshotMatch[2]) !== globalCounts["In progress"]
  || Number(snapshotMatch[3]) !== globalCounts["To do"]
  || Number(snapshotMatch[4]) !== stories.size
) {
  fail("IMPLEMENTATION-STATUS full-backlog snapshot does not match parsed stories.");
}

const reviewLine = backlogReadme
  .split(/\r?\n/)
  .find((line) => line.startsWith("Stories materially clarified on 2026-08-18"));
const reviewedIds = new Set(reviewLine?.match(/AIT-\d+/g) ?? []);
for (const storyId of new Set([...reviewedIds, ...specificationUpdated])) {
  if (reviewedIds.has(storyId) !== specificationUpdated.has(storyId)) {
    fail(`README specification-review index disagrees with the marker on ${storyId}.`);
  }
}

const markdownFiles = [];
function collectMarkdown(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectMarkdown(fullPath);
    else if (entry.name.endsWith(".md")) markdownFiles.push(fullPath);
  }
}
collectMarkdown(backlogDirectory);

for (const markdownFile of markdownFiles) {
  const content = fs.readFileSync(markdownFile, "utf8");
  const relativePath = path.relative(repositoryRoot, markdownFile);

  for (const reference of content.match(/AIT-\d+/g) ?? []) {
    if (!stories.has(reference)) fail(`${relativePath}: references unknown ${reference}.`);
  }

  for (const link of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = link[1].split("#", 1)[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(markdownFile), target);
    if (!fs.existsSync(resolved)) fail(`${relativePath}: broken link ${link[1]}.`);
  }
}

const releaseZero = read("docs/product-backlog/RELEASE-0.md");
const releaseStoryIds = new Set(
  [...releaseZero.matchAll(/^\| \d+ \| (AIT-\d+) \|/gm)].map((match) => match[1]),
);
if (releaseStoryIds.size !== 26) {
  fail(`Release 0 must contain exactly 26 ordered stories; found ${releaseStoryIds.size}.`);
}
for (const storyId of releaseStoryIds) {
  if (stories.get(storyId)?.status !== "Done") {
    fail(`Release 0 story ${storyId} is missing or not Done.`);
  }
}

if (errors.length > 0) {
  console.error(`Backlog validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Backlog valid: ${epics.size} epics, ${stories.size} stories `
      + `(${globalCounts.Done} Done, ${globalCounts["In progress"]} In progress, ${globalCounts["To do"]} To do), `
      + `${releaseStoryIds.size} Release 0 stories.`,
  );
}

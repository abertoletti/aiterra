import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs";

const [logPath, title = "Aiterra agent"] = process.argv.slice(2);
if (!logPath) throw new Error("An agent log path is required");
process.title = title;

let previous = "";
let stopping = false;
const refresh = () => {
  if (!existsSync(logPath)) {
    if (previous) finish("Log removed; closing console.");
    return;
  }
  const current = readFileSync(logPath, "utf8");
  if (current.length < previous.length) previous = "";
  const appended = current.slice(previous.length);
  if (appended) process.stdout.write(appended);
  previous = current;
  if (appended.includes("pilot_stopped")) finish("Pilot stopped. The complete log remains on disk.");
};

const finish = (message) => {
  if (stopping) return;
  stopping = true;
  unwatchFile(logPath);
  process.stdout.write(`\n${message}\n`);
  setTimeout(() => process.exit(0), 3_000);
};

refresh();
watchFile(logPath, { interval: 250 }, refresh);
process.on("SIGINT", () => finish("Console closed by user."));

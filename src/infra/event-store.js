import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class InMemoryEventStore {
  constructor(initialEvents = []) {
    this.events = structuredClone(initialEvents);
  }

  readAll() {
    return structuredClone(this.events);
  }

  append(event) {
    this.events.push(structuredClone(event));
  }
}

export class JsonlEventStore {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  readAll() {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, "utf8");
    if (!content.trim()) return [];

    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error(`Invalid event JSON at line ${index + 1}: ${error.message}`);
        }
      });
  }

  append(event) {
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  clear() {
    writeFileSync(this.filePath, "", "utf8");
  }
}


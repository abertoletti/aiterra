// Prints the exact system prompt an agent receives, so "the prompt never says X" can be
// checked against the prompt instead of against a log that never recorded it.
import { buildDecisionMessages } from "../src/agents/decision-planner.js";

const messages = buildDecisionMessages({
  contextMode: "progressive",
  character: { id: "sample" },
  summaries: [{ resource: "plots" }, { resource: "buildings" }],
  availableActions: [
    { type: "acquire_plot", gridWidth: 20, gridHeight: 20, pricePerPlot: 150 },
  ],
}, [], [], { contextRequestsRemaining: 2 });

const systemPrompt = messages[0].content;
const sentences = systemPrompt.split(". ").map((sentence, index) => ({
  index: index + 1,
  text: sentence.endsWith(".") ? sentence : `${sentence}.`,
}));

if (process.argv.includes("--full")) {
  console.log(systemPrompt);
} else {
  console.log(`system prompt: ${systemPrompt.length} characters, ${sentences.length} sentences\n`);
  for (const sentence of sentences) {
    const marker = /build|plot|city|construct|host_experience/i.test(sentence.text) ? ">>" : "  ";
    console.log(`${marker} [${String(sentence.index).padStart(2)}] ${sentence.text}`);
  }
}

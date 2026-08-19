import { runTwentyAgentTest } from "./simulation/twenty-agent-harness.js";

const report = await runTwentyAgentTest();
console.log(JSON.stringify(report, null, 2));

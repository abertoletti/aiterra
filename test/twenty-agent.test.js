import assert from "node:assert/strict";
import test from "node:test";
import { runTwentyAgentTest } from "../src/simulation/twenty-agent-harness.js";

test("twenty isolated reference agents complete the social and economic world loop through the public protocol", async () => {
  const report = await runTwentyAgentTest({ testRunId: "automated-20-agent-gate" });

  assert.equal(report.agentCount, 20);
  assert.equal(report.completedConversations, 10);
  assert.equal(report.activeConversations, 0);
  assert.equal(report.relationshipChanges, 20);
  assert.equal(report.completedSecondaryGoals, 10);
  assert.equal(report.completedJobs, 20);
  assert.equal(report.charactersPaid, 20);
  assert.equal(report.charactersAtFullEnergy, 20);
  assert.ok(report.ownerFeedItems > 0);
  assert.ok(report.ownerSummaryHighlights > 0);
  assert.equal(report.metrics.socialLoop.successfulConversationCompletionRate.value, 1);
  assert.equal(report.metrics.socialLoop.persistentConsequenceRate.value, 1);
  assert.equal(report.metrics.socialLoop.agentTimeoutRate.value, 0);
  assert.ok(report.metrics.stories.candidateCount >= 10);
  assert.equal(report.metrics.ownerInterest.interestingStoryRate.value, 1);
});

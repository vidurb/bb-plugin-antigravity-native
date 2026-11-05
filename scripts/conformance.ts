import assert from "node:assert/strict";
import {
  experimental_formatConformanceReport,
  experimental_runBridgeConformance,
} from "@get-bb/plugin-sdk/provider-bridge/testing";

type ConformanceReport = Awaited<
  ReturnType<typeof experimental_runBridgeConformance>
>;

// SDK 0.6.104's shared bridge advertises fork:tip before probing the agent.
// BB intersects this with our declaration (fork:none); direct conformance
// cannot do that. Require all other cells to pass and this exact upstream error.
export function assertConformance(report: ConformanceReport) {
  const summary = experimental_formatConformanceReport(report);
  for (const result of report.results) {
    if (result.id === "session/fork-identity" && result.status === "fail")
      assert.match(result.detail, /does not advertise session\/fork support/);
    else assert.notEqual(result.status, "fail", summary);
  }
}

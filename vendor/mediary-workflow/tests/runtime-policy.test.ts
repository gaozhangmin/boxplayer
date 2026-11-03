import { describe, expect, it } from "vitest";
import { assertWorkflowAgentAdapterPolicy } from "../src/index.js";

describe("assertWorkflowAgentAdapterPolicy", () => {
  it("rejects a fake agent when the live PanSou provider is enabled", () => {
    expect(() =>
      assertWorkflowAgentAdapterPolicy({
        MEDIA_TRACK_WORKFLOW_ADAPTER: "pansou",
      }),
    ).toThrow(/MEDIA_TRACK_AGENT_ADAPTER_REQUIRED_FOR_LIVE_WORKFLOW/);
  });

  it("rejects a fake agent when the live 115 storage executor is enabled", () => {
    expect(() =>
      assertWorkflowAgentAdapterPolicy({
        MEDIA_TRACK_STORAGE_ADAPTER: "115",
      }),
    ).toThrow(/MEDIA_TRACK_AGENT_ADAPTER_REQUIRED_FOR_LIVE_WORKFLOW/);
  });

  it("allows fake adapters for local demos", () => {
    expect(() =>
      assertWorkflowAgentAdapterPolicy({
        MEDIA_TRACK_WORKFLOW_ADAPTER: "fake",
        MEDIA_TRACK_STORAGE_ADAPTER: "fake",
      }),
    ).not.toThrow();
  });

  it("allows live adapters when the Vercel AI agent adapter is explicit", () => {
    expect(() =>
      assertWorkflowAgentAdapterPolicy({
        MEDIA_TRACK_WORKFLOW_ADAPTER: "pansou",
        MEDIA_TRACK_STORAGE_ADAPTER: "115",
        MEDIA_TRACK_AGENT_ADAPTER: "vercel-ai",
      }),
    ).not.toThrow();
  });
});

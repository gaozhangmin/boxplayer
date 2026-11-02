import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validateRuntimeConfig } from "../src/index.js";

describe("validateRuntimeConfig", () => {
  it("accepts the live trio (pansou + 115 + vercel-ai)", () => {
    expect(() =>
      validateRuntimeConfig({
        MEDIA_TRACK_WORKFLOW_ADAPTER: "pansou",
        MEDIA_TRACK_STORAGE_ADAPTER: "115",
        MEDIA_TRACK_AGENT_ADAPTER: "vercel-ai",
      }),
    ).not.toThrow();
  });

  it("rejects an invalid agent adapter value like 'real'", () => {
    expect(() => validateRuntimeConfig({ MEDIA_TRACK_AGENT_ADAPTER: "real" })).toThrow(
      /MEDIA_TRACK_AGENT_ADAPTER_INVALID/,
    );
  });

  it("rejects live workflow/storage without the vercel-ai agent", () => {
    expect(() =>
      validateRuntimeConfig({
        MEDIA_TRACK_WORKFLOW_ADAPTER: "pansou",
        MEDIA_TRACK_STORAGE_ADAPTER: "115",
        MEDIA_TRACK_AGENT_ADAPTER: "fake",
      }),
    ).toThrow(/MEDIA_TRACK_AGENT_ADAPTER_REQUIRED_FOR_LIVE_WORKFLOW/);
  });

  it("accepts the fake agent adapter (no live provider/storage)", () => {
    expect(() => validateRuntimeConfig({ MEDIA_TRACK_AGENT_ADAPTER: "fake" })).not.toThrow();
  });

  it("accepts an unset agent adapter", () => {
    expect(() => validateRuntimeConfig({})).not.toThrow();
  });
});

describe("docker-compose.yml web service config", () => {
  it("ships a valid runtime config (regression guard for the MEDIA_TRACK_AGENT_ADAPTER=real outage)", () => {
    // Resolve relative to THIS test file so it works regardless of the vitest
    // working directory (process.cwd() would require running from the repo root).
    const composePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docker-compose.yml");
    const compose = parse(readFileSync(composePath, "utf8")) as {
      services: { web: { environment: Record<string, string> } };
    };
    const webEnv = compose.services.web.environment;
    expect(webEnv).toBeTruthy();
    expect(webEnv.MEDIA_TRACK_AGENT_ADAPTER).toBeDefined();
    expect(() => validateRuntimeConfig(webEnv)).not.toThrow();
  });
});

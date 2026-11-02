import { describe, expect, it } from "vitest";
import {
  createAgentModel,
  createAgentProviderConfig,
  createAgentModelFromEnv,
  llmConfigError,
  normalizeLlmBaseUrl,
  sanitizeLlmApiKey,
} from "../src/agent-model.js";

/**
 * The live vercel-ai model factory — RESTORED after Phase 8 (764ae19) deleted it
 * with the dead structured-output agent. It is NOT dead: apps/web `getAgentModel`
 * calls createAgentModelFromEnv for every real (vercel-ai) run, and the §6a
 * interrogation script uses it. Losing it breaks live e2e at runtime even though
 * tsc stayed green (the web typechecked against a stale dist .d.ts).
 *
 * BYO model: the factory is model-AGNOSTIC. baseURL + modelId are REQUIRED;
 * apiKey is OPTIONAL (keyless local LLMs — ollama/LM Studio — are valid). There
 * is NO silent MiMo default (issue #49).
 */
describe("agent-model — the live OpenAI-compatible (BYO) LanguageModel factory", () => {
  it("maps explicit options onto provider settings (no invented defaults)", () => {
    const { providerSettings, modelId } = createAgentProviderConfig({
      baseURL: "https://example.test/v1",
      modelId: "custom-model",
    });
    expect(modelId).toBe("custom-model");
    expect(providerSettings.name).toBe("agent-model");
    expect(providerSettings.baseURL).toBe("https://example.test/v1");
  });

  // #49 real root cause: the key must go out BOTH ways. Standard OpenAI-compatible
  // providers (DeepSeek/OpenAI/Groq/OpenRouter) authenticate via
  // `Authorization: Bearer <key>`, which @ai-sdk/openai-compatible emits ONLY from
  // the provider's `apiKey` field — they IGNORE the `api-key` header. MiMo/Azure
  // read the `api-key` header. Sending both = universal compatibility.
  it("sends the key BOTH ways when apiKey is set (apiKey→Bearer AND api-key header)", () => {
    const { providerSettings } = createAgentProviderConfig({
      apiKey: "secret",
      baseURL: "https://example.test/v1",
      modelId: "custom-model",
    });
    expect(providerSettings.apiKey).toBe("secret");
    expect(providerSettings.headers).toEqual({ "api-key": "secret" });
  });

  it("omits BOTH apiKey and headers for a keyless local LLM", () => {
    const { providerSettings } = createAgentProviderConfig({
      baseURL: "http://localhost:11434/v1",
      modelId: "qwen2.5",
    });
    expect(providerSettings.apiKey).toBeUndefined();
    expect(providerSettings.headers).toBeUndefined();
  });

  // C1 (Copilot #51): a blank/whitespace apiKey (e.g. AGENT_MODEL_API_KEY= in
  // .env) must NOT send a key at all — neither Bearer nor `api-key: ""` — that
  // breaks keyless local LLMs with an avoidable 401.
  it("omits BOTH apiKey and headers for an EMPTY-STRING apiKey (keyless)", () => {
    const { providerSettings } = createAgentProviderConfig({
      apiKey: "",
      baseURL: "http://localhost:11434/v1",
      modelId: "qwen2.5",
    });
    expect(providerSettings.apiKey).toBeUndefined();
    expect(providerSettings.headers).toBeUndefined();
  });

  it("omits BOTH apiKey and headers for a whitespace-only apiKey (keyless)", () => {
    const { providerSettings } = createAgentProviderConfig({
      apiKey: "   ",
      baseURL: "http://localhost:11434/v1",
      modelId: "qwen2.5",
    });
    expect(providerSettings.apiKey).toBeUndefined();
    expect(providerSettings.headers).toBeUndefined();
  });

  it("trims the key (both Bearer + header), baseURL and modelId before building provider settings", () => {
    const { providerSettings, modelId } = createAgentProviderConfig({
      apiKey: "  secret  ",
      baseURL: "  https://example.test/v1  ",
      modelId: "  custom-model  ",
    });
    expect(providerSettings.apiKey).toBe("secret");
    expect(providerSettings.headers).toEqual({ "api-key": "secret" });
    expect(providerSettings.baseURL).toBe("https://example.test/v1");
    expect(modelId).toBe("custom-model");
  });

  it("throws an agnostic error (no MiMo) when baseURL is missing", () => {
    expect(() => createAgentProviderConfig({ modelId: "x" })).toThrow();
    try {
      createAgentProviderConfig({ modelId: "x" });
    } catch (error) {
      expect((error as Error).message.toLowerCase()).not.toContain("mimo");
    }
  });

  it("throws an agnostic error when modelId is missing", () => {
    expect(() => createAgentModel({ baseURL: "https://example.test/v1" })).toThrow();
  });

  it("builds a model from AGENT_MODEL_* env", () => {
    const model = createAgentModelFromEnv({
      AGENT_MODEL_API_KEY: "k",
      AGENT_MODEL_BASE_URL: "https://example.test/v1",
      AGENT_MODEL_ID: "some-model",
    } as NodeJS.ProcessEnv);
    expect(model).toBeDefined();
    expect((model as { modelId?: string }).modelId).toBe("some-model");
  });

  it("still reads the XIAOMI_MIMO_* env fallback (back-compat for existing instances)", () => {
    const fallback = createAgentModelFromEnv({
      XIAOMI_MIMO_API_KEY: "k2",
      XIAOMI_MIMO_BASE_URL: "https://token-plan-sgp.xiaomimimo.com/v1",
      XIAOMI_MIMO_MODEL_ID: "mimo-v2.5-pro",
    } as NodeJS.ProcessEnv);
    expect((fallback as { modelId?: string }).modelId).toBe("mimo-v2.5-pro");
  });

  it("throws (no silent default) when env configures nothing", () => {
    expect(() => createAgentModelFromEnv({} as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("llmConfigError — agnostic, BYO required-config predicate", () => {
  it("flags a missing baseURL", () => {
    expect(llmConfigError({ modelId: "x" })).not.toBeNull();
  });

  it("flags a blank baseURL", () => {
    expect(llmConfigError({ baseURL: "  ", modelId: "x" })).not.toBeNull();
  });

  it("flags a missing modelId", () => {
    expect(llmConfigError({ baseURL: "https://x/v1" })).not.toBeNull();
  });

  it("returns null when baseURL + modelId are present and no apiKey (keyless local LLM OK)", () => {
    expect(llmConfigError({ baseURL: "http://localhost:11434/v1", modelId: "qwen" })).toBeNull();
  });

  it("returns null when all three are present", () => {
    expect(
      llmConfigError({ apiKey: "sk-x", baseURL: "https://x/v1", modelId: "gpt-4o" }),
    ).toBeNull();
  });

  it("never mentions MiMo in the message", () => {
    expect((llmConfigError({}) ?? "").toLowerCase()).not.toContain("mimo");
  });

  // C2 (Copilot #51): clean, user-facing wording.
  it("uses the approved cleaned-up wording", () => {
    expect(llmConfigError({})).toBe(
      "未配置 AI 模型。请到「设置 → AI 模型」填写 Base URL 和模型名(任意 OpenAI 兼容服务,自带);云端服务还需 API Key,本地模型可留空。",
    );
  });
});

describe("normalizeLlmBaseUrl — provider appends /chat/completions itself", () => {
  it.each([
    ["https://x/v1/chat/completions", "https://x/v1"],
    ["https://x/v1/chat/completions/", "https://x/v1"],
    ["https://x/v1/", "https://x/v1"],
    ["https://x/v1", "https://x/v1"],
    ["  https://x/v1  ", "https://x/v1"],
    ["", ""],
    ["   ", ""],
  ])("normalizes %j -> %j", (input, expected) => {
    expect(normalizeLlmBaseUrl(input)).toBe(expected);
  });
});

describe("sanitizeLlmApiKey — strips paste contamination (keys are whitespace-free)", () => {
  it.each([
    ["tp-abc", "tp-abc"],
    [" tp-abc ", "tp-abc"],
    ["tp- ab\tc\n", "tp-abc"],
    ["", ""],
  ])("strips ASCII whitespace from %j", (input, expected) => {
    expect(sanitizeLlmApiKey(input)).toBe(expected);
  });

  it("strips invisible chars: NBSP, zero-width space, BOM (built from codepoints)", () => {
    const nbsp = String.fromCharCode(0x00a0);
    const zwsp = String.fromCharCode(0x200b);
    const bom = String.fromCharCode(0xfeff);
    const contaminated = `tp-${nbsp}ab${zwsp}c${bom}`;
    expect(contaminated.length).toBeGreaterThan("tp-abc".length);
    expect(sanitizeLlmApiKey(contaminated)).toBe("tp-abc");
  });
});

import { createOpenAICompatible, type OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * The live acquisition agent model factory — a bare OpenAI-compatible
 * LanguageModel that drives the V2 sandbox tool-loop. This was lost in Phase 8
 * (764ae19) when the dead structured-output agent (`ai-sdk-agent.ts`) was deleted
 * wholesale; but the FACTORY is live — `apps/web` `getAgentModel` calls
 * createAgentModelFromEnv for every real (vercel-ai) run, and the §6a
 * interrogation script uses it too. Restored here as a focused, dependency-light
 * module (no dead agent attached).
 *
 * Truly BYO + model-AGNOSTIC (issue #49): the self-hoster supplies their own
 * OpenAI-compatible endpoint (Settings → AI 模型 / env). `baseURL` + `modelId` are
 * REQUIRED — the factory invents NO default endpoint. `apiKey` is OPTIONAL: cloud
 * services need it (sent as the `api-key` header); keyless local LLMs
 * (ollama / LM Studio) legitimately omit it. There is NO silent author default.
 *
 * A bare model (no `response_format`) is all the V2 agent needs — it uses the AI
 * SDK tool-loop with zod inputSchemas, never structured output.
 */

const DEFAULT_PROVIDER_NAME = "agent-model";

export interface AgentModelOptions {
  apiKey?: string;
  baseURL?: string;
  modelId?: string;
  providerName?: string;
}

/**
 * Agnostic (model-vendor-neutral) error for an LLM config that cannot build a
 * model: returns a message when `baseURL` or `modelId` is missing/blank, else
 * null. `apiKey` is NOT required (keyless local LLMs are valid). PURE + exported
 * so the fail-fast upstream pre-check reuses the SAME predicate the factory
 * enforces. NEVER mentions a specific provider.
 */
export function llmConfigError(cfg: { apiKey?: string; baseURL?: string; modelId?: string }): string | null {
  const baseURL = (cfg.baseURL ?? "").trim();
  const modelId = (cfg.modelId ?? "").trim();
  if (baseURL === "" || modelId === "") {
    return "未配置 AI 模型。请到「设置 → AI 模型」填写 Base URL 和模型名(任意 OpenAI 兼容服务,自带);云端服务还需 API Key,本地模型可留空。";
  }
  return null;
}

/** Map options onto OpenAI-compatible provider settings. baseURL + modelId are
 *  REQUIRED (no invented default); apiKey is optional (keyless local LLMs). Throws
 *  the agnostic config error as a backstop — the friendly pre-check upstream
 *  catches the same gap first. */
export function createAgentProviderConfig(options: AgentModelOptions = {}): {
  providerSettings: OpenAICompatibleProviderSettings;
  modelId: string;
} {
  const configError = llmConfigError(options);
  if (configError) {
    throw new Error(configError);
  }
  // Trim before building: llmConfigError validates on trimmed values, so the
  // provider must use the trimmed values too (a pasted "  https://x/v1  " would
  // otherwise hit a malformed endpoint).
  //
  // Send the key BOTH ways when present (#49 real root cause):
  //  - `apiKey`  → the provider emits `Authorization: Bearer <key>`. This is how
  //    STANDARD OpenAI-compatible services authenticate — DeepSeek, OpenAI, Groq,
  //    OpenRouter, … — and they IGNORE a custom `api-key` header. Without this a
  //    correctly-configured DeepSeek key still 401s.
  //  - `headers: { "api-key": <key> }` → MiMo / Azure-OpenAI read this header.
  // They coexist safely: the provider merges
  // `{ ...(apiKey && { Authorization }), ...headers }`, and our header key is
  // `api-key` (not `Authorization`), so neither clobbers the other.
  //
  // A blank/whitespace key (e.g. AGENT_MODEL_API_KEY= in .env) → send NEITHER
  // (keyless local LLM — ollama/LM Studio; sending an empty key would 401) (C1).
  const key = options.apiKey?.trim();
  const providerSettings: OpenAICompatibleProviderSettings = {
    name: options.providerName ?? DEFAULT_PROVIDER_NAME,
    baseURL: options.baseURL!.trim(),
    ...(key ? { apiKey: key, headers: { "api-key": key } } : {}),
  };
  return { providerSettings, modelId: options.modelId!.trim() };
}

/** Build the live LanguageModel from explicit options (DB settings). Honors the
 *  user's Settings → AI 模型 config (BYO self-host). Throws the agnostic config
 *  error when baseURL/modelId are missing. */
export function createAgentModel(options: AgentModelOptions = {}): LanguageModel {
  const { providerSettings, modelId } = createAgentProviderConfig(options);
  return createOpenAICompatible(providerSettings)(modelId);
}

/**
 * Build the live LanguageModel from env. Reads AGENT_MODEL_* with XIAOMI_MIMO_*
 * as the fallback (back-compat: existing instances that set the legacy keys keep
 * working). Same precedence the web/worker and interrogation use.
 */
export function createAgentModelFromEnv(env: NodeJS.ProcessEnv = process.env): LanguageModel {
  const options: AgentModelOptions = {};
  const apiKey = env.AGENT_MODEL_API_KEY ?? env.XIAOMI_MIMO_API_KEY;
  const baseURL = env.AGENT_MODEL_BASE_URL ?? env.XIAOMI_MIMO_BASE_URL;
  const modelId = env.AGENT_MODEL_ID ?? env.XIAOMI_MIMO_MODEL_ID;
  if (apiKey !== undefined) options.apiKey = apiKey;
  if (baseURL !== undefined) options.baseURL = baseURL;
  if (modelId !== undefined) options.modelId = modelId;
  const { providerSettings, modelId: id } = createAgentProviderConfig(options);
  return createOpenAICompatible(providerSettings)(id);
}

/**
 * Normalize a user-entered OpenAI-compatible base URL. The provider appends
 * `/chat/completions` itself, so a pasted full endpoint (or trailing slashes)
 * must be stripped — otherwise requests hit `…/chat/completions/chat/completions`
 * (404). Empty / whitespace-only → "".
 */
export function normalizeLlmBaseUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  s = s.replace(/\/chat\/completions$/i, "");
  s = s.replace(/\/+$/, "");
  return s;
}

// Invisible codepoints not covered by the regex \s class: zero-width space,
// zero-width non-joiner, zero-width joiner. (NBSP U+00A0 and BOM U+FEFF ARE in \s.)
const INVISIBLE_CODEPOINTS = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);

/**
 * Strip ALL whitespace + invisible characters from a pasted API key (keys are
 * whitespace-free tokens). Defends against web-copy contamination — spaces,
 * tabs, newlines, NBSP, zero-width chars, BOM — that would otherwise silently
 * store a wrong value and make the user think their key is bad. Built from
 * codepoints (no invisible literals in source — those are exactly what we strip).
 */
export function sanitizeLlmApiKey(raw: string): string {
  let out = "";
  for (const ch of raw) {
    if (/\s/.test(ch)) continue;
    if (INVISIBLE_CODEPOINTS.has(ch.codePointAt(0) ?? -1)) continue;
    out += ch;
  }
  return out;
}

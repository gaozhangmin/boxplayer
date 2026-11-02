import { describe, expect, it } from "vitest";

import { LLM_AUTH_GUIDANCE, describeAgentRunError } from "./agent-error.js";

describe("describeAgentRunError", () => {
  it("maps a bare 'Unauthorized' error to the actionable LLM-auth guidance", () => {
    expect(describeAgentRunError(new Error("Unauthorized"))).toBe(LLM_AUTH_GUIDANCE);
  });

  it("maps a 401 status-code APICallError-shaped error to the guidance", () => {
    const apiError = Object.assign(new Error("Request failed"), { statusCode: 401 });
    expect(describeAgentRunError(apiError)).toBe(LLM_AUTH_GUIDANCE);
  });

  it("maps a 403 'Forbidden' error to the guidance", () => {
    expect(describeAgentRunError(new Error("Forbidden"))).toBe(LLM_AUTH_GUIDANCE);
  });

  it("maps an 'invalid api key' message to the guidance", () => {
    expect(describeAgentRunError(new Error("invalid api key"))).toBe(LLM_AUTH_GUIDANCE);
  });

  it("detects an auth failure wrapped in the error cause chain (AI SDK wrapping)", () => {
    const inner = new Error("invalid api key");
    const outer = new Error("model call failed");
    (outer as Error & { cause?: unknown }).cause = inner;
    expect(describeAgentRunError(outer)).toBe(LLM_AUTH_GUIDANCE);
  });

  it("leaves a non-LLM error message unchanged (e.g. a transfer failure)", () => {
    expect(describeAgentRunError(new Error("QUARK_TRANSFER_FAILED: dead share"))).toBe(
      "QUARK_TRANSFER_FAILED: dead share",
    );
  });

  it("returns a stable string for a non-Error value", () => {
    expect(describeAgentRunError("Workflow failed")).toBe("Workflow failed");
  });

  it("maps an 'incorrect api key' message to the guidance", () => {
    expect(describeAgentRunError(new Error("Incorrect API key provided"))).toBe(LLM_AUTH_GUIDANCE);
  });

  it("never mentions MiMo in the auth guidance", () => {
    expect(LLM_AUTH_GUIDANCE.toLowerCase()).not.toContain("mimo");
  });

  it("uses the approved agnostic runtime-401 guidance text", () => {
    expect(LLM_AUTH_GUIDANCE).toBe(
      "AI 模型鉴权失败(401):请到 设置 → AI 模型 检查 API Key 是否有效、模型是否有权限(任意 OpenAI 兼容服务,自带 key)。",
    );
  });
});

// C3 (Copilot #51): the LLM-auth classifier must NOT swallow netdisk (brand) auth
// errors. They carry "401"/"403" in their message (e.g. GUANGYA_AUTH_FAILED: 401
// after refresh) but are a 网盘 token problem, not an AI-模型 problem — showing the
// "AI 模型鉴权失败" guidance for them is misleading.
describe("describeAgentRunError — does NOT misclassify netdisk (brand) auth errors as LLM-auth", () => {
  it("leaves a GuangYa 401 auth error UNCHANGED (not the AI 模型 message)", () => {
    const msg = "GUANGYA_AUTH_FAILED: 401 after refresh (/file/list)";
    expect(describeAgentRunError(new Error(msg))).toBe(msg);
  });

  it("leaves a GuangYa validate 401 error UNCHANGED", () => {
    const msg = "GUANGYA_VALIDATE_FAILED: 401 after refresh";
    expect(describeAgentRunError(new Error(msg))).toBe(msg);
  });

  it("leaves a Quark 403 auth error UNCHANGED", () => {
    const msg = "QUARK_AUTH_FAILED: 需要验证 (code 403)";
    expect(describeAgentRunError(new Error(msg))).toBe(msg);
  });

  it("leaves a Pan115 auth error UNCHANGED", () => {
    const msg = "PAN115_AUTH_FAILED: 登录失效 401";
    expect(describeAgentRunError(new Error(msg))).toBe(msg);
  });

  it("leaves a Tianyi auth error UNCHANGED (dead session ≠ AI 模型 401)", () => {
    const msg = "TIANYI_AUTH_FAILED: InvalidSessionKey (check ip error) 401";
    expect(describeAgentRunError(new Error(msg))).toBe(msg);
  });

  it("leaves a Pan123 auth error UNCHANGED even when the upstream text says 'unauthorized'", () => {
    // Pan123Client throws `PAN123_AUTH_FAILED: ${upstream message}` — the upstream
    // text can carry LLM-looking words; the brand prefix must win.
    const msg = "PAN123_AUTH_FAILED: unauthorized (token 已失效)";
    expect(describeAgentRunError(new Error(msg))).toBe(msg);
  });

  it("leaves a Pan123AuthError with a 401 statusCode UNCHANGED (dead 90-day token ≠ AI 模型 401)", () => {
    const brand = Object.assign(new Error("PAN123_AUTH_FAILED: token expired"), {
      statusCode: 401,
      name: "Pan123AuthError",
    });
    expect(describeAgentRunError(brand)).toBe("PAN123_AUTH_FAILED: token expired");
  });

  it("leaves a TianyiAuthError with a 401 statusCode UNCHANGED (brand prefix wins)", () => {
    const brand = Object.assign(new Error("TIANYI_AUTH_FAILED: session invalid"), {
      statusCode: 401,
      name: "TianyiAuthError",
    });
    expect(describeAgentRunError(brand)).toBe("TIANYI_AUTH_FAILED: session invalid");
  });

  it("leaves a brand auth error with a 401 statusCode UNCHANGED (brand prefix wins)", () => {
    const brand = Object.assign(new Error("GUANGYA_AUTH_FAILED: 401 after refresh"), {
      statusCode: 401,
      name: "GuangYaAuthError",
    });
    expect(describeAgentRunError(brand)).toBe("GUANGYA_AUTH_FAILED: 401 after refresh");
  });

  it("still maps a real AI-SDK 401 (no brand prefix) to the guidance", () => {
    const apiError = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    expect(describeAgentRunError(apiError)).toBe(LLM_AUTH_GUIDANCE);
  });

  it("does NOT map a bare numeric 401 in an unrelated message to the guidance", () => {
    const msg = "HTTP 401 while fetching subtitle index";
    expect(describeAgentRunError(new Error(msg))).toBe(msg);
  });
});

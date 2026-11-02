import { describe, expect, it } from "vitest";
import type { ToolSet } from "ai";
import { buildSandboxToolSet } from "../src/acquisition-v2/agent-loop.js";
import type { TaskSandbox } from "../src/acquisition-v2/sandbox.js";

type ExecutableTool = { execute: (args: unknown, options: unknown) => Promise<unknown> };

describe("buildSandboxToolSet onToolCall", () => {
  it("fires onToolCall with the tool name + args BEFORE the sandbox runs, and still returns the result", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const fakeSandbox = {
      searchResources: async (keyword: string) => ({ keyword, candidates: [] }),
    } as unknown as TaskSandbox;

    const tools = buildSandboxToolSet(fakeSandbox, {
      onToolCall: (name, args) => calls.push({ name, args }),
    }) as ToolSet & Record<string, ExecutableTool>;

    const result = await tools.searchResources!.execute({ keyword: "斗破苍穹" }, {});

    expect(calls).toEqual([{ name: "searchResources", args: { keyword: "斗破苍穹" } }]);
    expect(result).toMatchObject({ keyword: "斗破苍穹" });
  });

  it("a throwing onToolCall never breaks the tool execution", async () => {
    const fakeSandbox = {
      searchResources: async (keyword: string) => ({ keyword }),
    } as unknown as TaskSandbox;

    const tools = buildSandboxToolSet(fakeSandbox, {
      onToolCall: () => {
        throw new Error("sink blew up");
      },
    }) as ToolSet & Record<string, ExecutableTool>;

    await expect(tools.searchResources!.execute({ keyword: "x" }, {})).resolves.toMatchObject({ keyword: "x" });
  });

  it("without onToolCall or logging the toolset is returned unwrapped (passthrough)", () => {
    const fakeSandbox = { searchResources: async () => ({}) } as unknown as TaskSandbox;
    const tools = buildSandboxToolSet(fakeSandbox);
    expect(typeof (tools as Record<string, ExecutableTool>).searchResources!.execute).toBe("function");
  });
});

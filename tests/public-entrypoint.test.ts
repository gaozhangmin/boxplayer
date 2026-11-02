import { describe, expect, it } from "vitest";
import * as workflow from "../src/index.js";

describe("workflow public entrypoint", () => {
  it("does not expose adapter smoke harnesses as production workflow APIs", () => {
    expect("runPan115ShareTransferSmoke" in workflow).toBe(false);
    expect("runPan115ShareAdapterSmoke" in workflow).toBe(false);
  });
});

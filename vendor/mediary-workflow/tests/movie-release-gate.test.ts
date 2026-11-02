import { describe, expect, it } from "vitest";
import { isMovieUnreleased } from "../src/index.js";

// The air-time gate: a movie is "unreleased" (→ reserve, don't run the agent yet)
// only when it has a release date that is still in the FUTURE relative to now.
// A missing/empty release date is treated as released (never gate on the unknown —
// the patrol's no_coverage retry already handles 已上映无源). Comparison is by the
// calendar date (YYYY-MM-DD), so the day it releases it counts as released.
describe("isMovieUnreleased — the reserve air-time gate", () => {
  const now = "2026-06-15T12:00:00.000Z";

  it("future release date → unreleased (reserve)", () => {
    expect(isMovieUnreleased("2026-12-25", now)).toBe(true);
  });

  it("past release date → released (acquire)", () => {
    expect(isMovieUnreleased("2024-01-01", now)).toBe(false);
  });

  it("today's release date → released (acquire from today)", () => {
    expect(isMovieUnreleased("2026-06-15", now)).toBe(false);
  });

  it("missing / empty / null release date → released (never gate on the unknown)", () => {
    expect(isMovieUnreleased(null, now)).toBe(false);
    expect(isMovieUnreleased(undefined, now)).toBe(false);
    expect(isMovieUnreleased("", now)).toBe(false);
  });

  it("compares by calendar date, ignoring time of day", () => {
    // release at 2026-06-16 is still future even though now is late on the 15th
    expect(isMovieUnreleased("2026-06-16", "2026-06-15T23:59:00.000Z")).toBe(true);
  });
});

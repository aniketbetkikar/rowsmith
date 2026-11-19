import { describe, expect, it } from "vitest";
import { formatDuration, formatEstimate, formatPerField, minutesSaved } from "./time-saved";

describe("time saved", () => {
  it("multiplies filled cells by minutes per field", () => {
    expect(minutesSaved(78, 2)).toBe(156);
    expect(minutesSaved(72, 0.5)).toBe(36);
    expect(formatEstimate(156)).toBe("~2.6 hours");
    expect(formatEstimate(60)).toBe("~1 hour");
    expect(formatEstimate(44.6)).toBe("~45 min");
  });

  it("formats the per-field assumption", () => {
    expect(formatPerField(0.5)).toBe("30 sec");
    expect(formatPerField(2)).toBe("2 min");
  });

  it("formats measured durations", () => {
    expect(formatDuration(71_000)).toBe("71 seconds");
    expect(formatDuration(240_000)).toBe("4 minutes");
    expect(formatDuration(65 * 60_000)).toBe("1 hr 5 min");
    expect(formatDuration(120 * 60_000)).toBe("2 hr");
  });
});

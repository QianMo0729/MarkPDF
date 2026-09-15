import { describe, expect, it } from "vitest";
import {
  fmtClock,
  fmtClockPadded,
  fmtDuration,
  fmtTimestampToken,
  parseClock,
} from "../src/core/utils/time";

describe("fmtClock", () => {
  it("formats minutes and seconds without hours", () => {
    expect(fmtClock(0)).toBe("0:00");
    expect(fmtClock(723_000)).toBe("12:03");
    expect(fmtClock(59_999)).toBe("0:59");
  });
  it("adds hours and pads minutes when over an hour", () => {
    expect(fmtClock(3_735_000)).toBe("1:02:15");
    expect(fmtClock(3_600_000)).toBe("1:00:00");
  });
  it("clamps negatives", () => {
    expect(fmtClock(-5)).toBe("0:00");
  });
});

describe("fmtClockPadded", () => {
  it("always shows hh:mm:ss", () => {
    expect(fmtClockPadded(0)).toBe("00:00:00");
    expect(fmtClockPadded(723_000)).toBe("00:12:03");
    expect(fmtClockPadded(5_480_000)).toBe("01:31:20");
  });
});

describe("timestamp tokens", () => {
  it("round trips", () => {
    expect(fmtTimestampToken(723_000)).toBe("[12:03] ");
    expect(parseClock("12:03")).toBe(723_000);
    expect(parseClock("1:02:15")).toBe(3_735_000);
    expect(parseClock("1:99")).toBeNull();
    expect(parseClock("abc")).toBeNull();
  });
});

describe("fmtDuration", () => {
  it("uses Chinese units", () => {
    expect(fmtDuration(5_480_000)).toBe("1小时31分");
    expect(fmtDuration(1_860_000)).toBe("31分");
    expect(fmtDuration(45_000)).toBe("45秒");
  });
});

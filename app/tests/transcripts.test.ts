import { describe, expect, it } from "vitest";
import { detectLang } from "../src/data/db/repos/transcripts";

describe("detectLang", () => {
  it("labels Chinese, English and mixed segments", () => {
    expect(detectLang("今天讲傅里叶变换")).toBe("zh");
    expect(detectLang("Today we talk about the Fourier transform.")).toBe("en");
    expect(detectLang("这个叫 Fourier transform")).toBe("mixed");
  });

  it("treats single latin letters inside Chinese as Chinese", () => {
    expect(detectLang("变量 x 的取值")).toBe("zh");
  });
});

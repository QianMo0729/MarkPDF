import { describe, expect, it } from "vitest";
import { ASR_MODELS, ASR_TIERS, DEFAULT_MODEL_ID, estimateRamMiB, expectedFiles, modelForLang, modelsForLang, tierOf } from "../src/core/asrModels";

const MIB = 1024 * 1024;

describe("ASR model tiers", () => {
  it("assigns every model to the smallest tier its download fits in", () => {
    for (const m of ASR_MODELS) {
      const tier = tierOf(m);
      expect(m.sizeBytes).toBeLessThanOrEqual(tier.maxMiB * MIB);
      const smaller = ASR_TIERS.filter((t) => t.maxMiB < tier.maxMiB);
      for (const t of smaller) expect(m.sizeBytes).toBeGreaterThan(t.maxMiB * MIB);
    }
    expect(new Set(ASR_MODELS.map((m) => tierOf(m).id)).size).toBe(4);
  });

  it("keeps ids unique and every file mapped to the on-disk layout the engine expects", () => {
    expect(new Set(ASR_MODELS.map((m) => m.id)).size).toBe(ASR_MODELS.length);
    for (const m of ASR_MODELS) {
      const names = expectedFiles(m).map((f) => f.name).sort();
      if (m.layout === "zipformer2-ctc") expect(names).toEqual(["model.onnx", "tokens.txt"]);
      else expect(names).toEqual(["decoder.onnx", "encoder.onnx", "joiner.onnx", "tokens.txt"]);
      for (const f of expectedFiles(m)) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.sizeBytes).toBe(Object.values(m.files).reduce((n, f) => n + f.size_bytes, 0));
    }
  });

  it("uses the built-in defaults until the user picks a model, and follows the pick when set", () => {
    expect(modelForLang("auto").id).toBe(DEFAULT_MODEL_ID.zh);
    expect(modelForLang("zh").id).toBe(DEFAULT_MODEL_ID.zh);
    expect(modelForLang("en").id).toBe(DEFAULT_MODEL_ID.en);
    expect(modelForLang("zh", { zh: "zipformer-zh-int8-2025" }).id).toBe("zipformer-zh-int8-2025");
    expect(modelForLang("auto", { zh: "zipformer-zh-int8-2025" }).id).toBe("zipformer-zh-int8-2025");
    // An English-only model cannot become the Chinese choice; an unknown id is ignored.
    expect(modelForLang("zh", { zh: "zipformer-en-int8" }).id).toBe(DEFAULT_MODEL_ID.zh);
    expect(modelForLang("en", { en: "nope" }).id).toBe(DEFAULT_MODEL_ID.en);
  });

  it("lists fallbacks after the selection: pick, default, then every other model for the language", () => {
    const list = modelsForLang("zh", { zh: "zipformer-zh-xlarge-int8-2025" }).map((m) => m.id);
    expect(list[0]).toBe("zipformer-zh-xlarge-int8-2025");
    expect(list[1]).toBe(DEFAULT_MODEL_ID.zh);
    expect(new Set(list).size).toBe(list.length);
    for (const id of list) expect(ASR_MODELS.find((m) => m.id === id)?.langs).toContain("zh");
  });

  it("estimates memory from weights and precision, and never below the measured samples' scale", () => {
    expect(estimateRamMiB(70 * MIB, "int8")).toBeGreaterThan(120);
    expect(estimateRamMiB(300 * MIB, "fp16")).toBeGreaterThan(estimateRamMiB(300 * MIB, "int8"));
    for (const m of ASR_MODELS) expect(m.ram.estimatedMiB).toBeGreaterThan(m.sizeBytes / MIB);
  });
});

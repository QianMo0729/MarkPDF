// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ensureModelFiles, type LocalModel, type ModelStorage } from "../src/data/translation/modelFiles";

const fixture = new TextEncoder().encode("hello");
const model: LocalModel = {
  id: "test-en-zh", from: "en", to: "zh-Hans", version: "test", label: "测试中英",
  files: [{type: "model", name: "model.bin", size: 5,
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    url: "https://example.invalid/model.bin"}],
};

function makeStorage(initial?: Uint8Array): ModelStorage & {files: Map<string, Uint8Array>} {
  const files = new Map<string, Uint8Array>();
  if (initial) files.set("test-en-zh/model.bin", initial);
  return {files,
    read: async (key) => files.get(key) ?? null,
    write: async (key, bytes) => { files.set(key, bytes); },
    remove: async (key) => { files.delete(key); },
    size: async (key) => files.get(key)?.byteLength ?? null,
  };
}

describe("local translation cache integrity", () => {
  it("uses a verified cached model without calling the network", async () => {
    const storage = makeStorage(fixture);
    const network = vi.fn(async () => { throw new Error("offline"); });
    const result = await ensureModelFiles(model, storage, network);
    expect(new TextDecoder().decode(result.model)).toBe("hello");
    expect(network).not.toHaveBeenCalled();
  });

  it("detects same-size corruption by digest and repairs before inference", async () => {
    const storage = makeStorage(new TextEncoder().encode("wrong"));
    const network = vi.fn(async () => fixture);
    const result = await ensureModelFiles(model, storage, network);
    expect(network).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(result.model)).toBe("hello");
    expect(storage.files.get("test-en-zh/model.bin")).toEqual(fixture);
  });

  it("rejects a mismatched download without caching it", async () => {
    const storage = makeStorage();
    await expect(ensureModelFiles(model, storage, async () => new TextEncoder().encode("wrong"))).rejects.toThrow("校验失败");
    expect(storage.files.size).toBe(0);
  });

  it("never writes model bytes after cancellation during download", async () => {
    const storage = makeStorage();
    const controller = new AbortController();
    await expect(ensureModelFiles(model, storage, async () => { controller.abort(); return fixture; }, {signal: controller.signal})).rejects.toMatchObject({name: "AbortError"});
    expect(storage.files.size).toBe(0);
  });

  it("does not read or download when already cancelled", async () => {
    const storage = makeStorage();
    const read = vi.spyOn(storage, "read");
    const network = vi.fn(async () => fixture);
    await expect(ensureModelFiles(model, storage, network, {signal: AbortSignal.abort()})).rejects.toMatchObject({name: "AbortError"});
    expect(read).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("retains validated earlier files when a later download fails", async () => {
    const twoFiles = {...model, files: [...model.files, {...model.files[0], name: "vocab.bin", type: "vocab"}]};
    const storage = makeStorage();
    const network = vi.fn(async (file) => {
      if (file.name === "vocab.bin") throw new Error("connection reset");
      return fixture;
    });
    await expect(ensureModelFiles(twoFiles, storage, network)).rejects.toThrow("connection reset");
    expect(storage.files.size).toBe(1);
    expect(storage.files.has("test-en-zh/model.bin")).toBe(true);
  });
});

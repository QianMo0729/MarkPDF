/**
 * Built-in model manifest (docs/SPEC.md 7.6 / 16.2). Files are fetched individually from
 * Hugging Face (or a mirror chosen in settings) so no archive extraction is needed.
 * Sizes and SHA-256 digests are the exact values published by the model repos
 * (Hugging Face LFS metadata; tokens.txt digests computed from the downloaded files
 * on 2026-09-16); a download is only "ready" when both match (release audit B05).
 *
 * Models are grouped into download-size tiers so a user can pick by machine:
 * ≤200 MiB / ≤500 MiB / ≤1000 MiB / ≤2000 MiB. Every model here is a streaming
 * (online) sherpa-onnx model, so it serves live transcription and offline
 * re-transcription alike. Memory numbers are the process working-set cost of
 * loading + decoding measured on Windows x64 (`tests/asr_memory.rs`); models
 * that were not measured carry an estimate derived from the measured ones.
 */

export interface AsrModelFile {
  /** Path inside the model repo. */
  path: string;
  /** Name on disk: encoder / decoder / joiner / tokens for transducers, model / tokens for CTC. */
  name: string;
  size_bytes: number;
  sha256: string;
}

export type AsrLang = "zh" | "en";
export type AsrPrecision = "int8" | "fp16" | "fp32";
export type AsrLayout = "transducer" | "zipformer2-ctc";
export type AsrTierId = "lite" | "standard" | "high" | "max";

export interface AsrTier {
  id: AsrTierId;
  label: string;
  /** Download size ceiling of the tier. */
  maxMiB: number;
  recommendedRamGb: number;
  note: string;
}

export const ASR_TIERS: AsrTier[] = [
  { id: "lite", label: "轻量", maxMiB: 200, recommendedRamGb: 4, note: "任何近几年的笔记本都能实时转写。" },
  { id: "standard", label: "标准", maxMiB: 500, recommendedRamGb: 8, note: "半精度 / 全精度权重，识别稍准，主流笔记本仍可实时。" },
  { id: "high", label: "高精度", maxMiB: 1000, recommendedRamGb: 8, note: "更大的网络，中文识别明显更准；建议 8 GB 以上内存、较新的 CPU。" },
  { id: "max", label: "旗舰", maxMiB: 2000, recommendedRamGb: 16, note: "最强的中文流式模型；需要 16 GB 内存，老机器上实时转写可能跟不上语速。" },
];

export interface AsrModelDef {
  id: string;
  name: string;
  langs: AsrLang[];
  repo: string;
  layout: AsrLayout;
  precision: AsrPrecision;
  /** Release date of the exported model (YYYY-MM-DD). */
  released: string;
  files: Record<string, AsrModelFile>;
  sizeBytes: number;
  /** Working-set cost in MiB: a measurement on this project's reference machine, or an estimate. */
  ram: { measuredMiB?: number; estimatedMiB: number };
  notes: string;
}

const MIB = 1024 * 1024;

/**
 * Rough working-set cost from weights size, calibrated on three measured int8
 * models (cost ≈ 1.07 × weights + 69 MiB, see tests/asr_memory.rs). fp16 weights
 * are widened to fp32 by onnxruntime's CPU kernels, so they count double.
 */
export function estimateRamMiB(sizeBytes: number, precision: AsrPrecision): number {
  const factor = precision === "int8" ? 1.15 : precision === "fp16" ? 2.1 : 1.1;
  return Math.round((sizeBytes / MIB) * factor + 70);
}

function sum(files: Record<string, AsrModelFile>): number {
  return Object.values(files).reduce((n, f) => n + f.size_bytes, 0);
}

function def(d: Omit<AsrModelDef, "sizeBytes" | "ram"> & { measuredMiB?: number }): AsrModelDef {
  const sizeBytes = sum(d.files);
  const { measuredMiB, ...rest } = d;
  return { ...rest, sizeBytes, ram: { measuredMiB, estimatedMiB: estimateRamMiB(sizeBytes, d.precision) } };
}

const ZH_2025_TOKENS = { path: "tokens.txt", name: "tokens.txt", size_bytes: 20_628, sha256: "6193c7ea1c96d0d9a1e9652789b40d13a8a913b434a5451e93158f5a09fd6652" };
const ZH_XL_2025_TOKENS = { path: "tokens.txt", name: "tokens.txt", size_bytes: 18_626, sha256: "6722bd1585f46f84456b29c3550a343a3cc375b971645773c02ed8e0b4e2405c" };
const EN_TOKENS = { path: "tokens.txt", name: "tokens.txt", size_bytes: 5_048, sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb" };
const BILINGUAL_TOKENS = { path: "tokens.txt", name: "tokens.txt", size_bytes: 56_317, sha256: "a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3" };

export const ASR_MODELS: AsrModelDef[] = [
  // ----- Chinese + English -----
  def({
    id: "zipformer-bilingual-zh-en-int8",
    measuredMiB: 262,
    name: "中英双语 · 流式 zipformer（int8）",
    langs: ["zh", "en"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20",
    layout: "transducer",
    precision: "int8",
    released: "2023-02-20",
    files: {
      encoder: { path: "encoder-epoch-99-avg-1.int8.onnx", name: "encoder.onnx", size_bytes: 181_895_032, sha256: "8fa764187a261844f859d7143ebaa563af5d10adfece4c18a8f414c88cba2a9b" },
      decoder: { path: "decoder-epoch-99-avg-1.onnx", name: "decoder.onnx", size_bytes: 13_876_452, sha256: "2e3b5ec371f8899ee6acd829fd753ba45772df57a91bdf37cde3136354e7db7d" },
      joiner: { path: "joiner-epoch-99-avg-1.int8.onnx", name: "joiner.onnx", size_bytes: 3_228_404, sha256: "1ed689c5ed19dbaa725d9d191bb4822b5f4855a39e1ffd28cbc1f340d25b2ee0" },
      tokens: BILINGUAL_TOKENS,
    },
    notes: "中英混说课堂的默认模型；数万小时内部数据训练。",
  }),
  def({
    id: "zipformer-bilingual-zh-en-fp32",
    name: "中英双语 · 流式 zipformer（fp32）",
    langs: ["zh", "en"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20",
    layout: "transducer",
    precision: "fp32",
    released: "2023-02-20",
    files: {
      encoder: { path: "encoder-epoch-99-avg-1.onnx", name: "encoder.onnx", size_bytes: 330_083_505, sha256: "709f0ed53a734b7942f170127e7547b566cb29c4afc5e67719f314c3d63ccb10" },
      decoder: { path: "decoder-epoch-99-avg-1.onnx", name: "decoder.onnx", size_bytes: 13_876_452, sha256: "2e3b5ec371f8899ee6acd829fd753ba45772df57a91bdf37cde3136354e7db7d" },
      joiner: { path: "joiner-epoch-99-avg-1.onnx", name: "joiner.onnx", size_bytes: 12_833_618, sha256: "5f2adc585dd1bec6421c8bb8660d2a73fc8b9ceb24491ef51399ba2a2f0fc31b" },
      tokens: BILINGUAL_TOKENS,
    },
    notes: "同一模型的全精度权重，比 int8 略准、略慢。",
  }),
  // ----- Chinese -----
  def({
    id: "zipformer-small-ctc-zh-int8-2025",
    name: "中文 · 小型流式 zipformer CTC（int8，2025）",
    langs: ["zh"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01",
    layout: "zipformer2-ctc",
    precision: "int8",
    released: "2025-04-01",
    files: {
      model: { path: "model.int8.onnx", name: "model.onnx", size_bytes: 26_342_340, sha256: "68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a" },
      tokens: { path: "tokens.txt", name: "tokens.txt", size_bytes: 13_366, sha256: "6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd" },
    },
    notes: "最省资源的中文模型（26 MB），适合旧机器；只识别中文。",
  }),
  def({
    id: "zipformer-zh-int8-2025",
    measuredMiB: 250,
    name: "中文 · 流式 zipformer 大模型（int8，2025）",
    langs: ["zh"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30",
    layout: "transducer",
    precision: "int8",
    released: "2025-06-30",
    files: {
      encoder: { path: "encoder.int8.onnx", name: "encoder.onnx", size_bytes: 161_141_793, sha256: "5ac51e27981bb4dab01bb9be4958453ba50c3b61c063ddda0eab23fd3671aa4f" },
      decoder: { path: "decoder.onnx", name: "decoder.onnx", size_bytes: 5_165_083, sha256: "06522ad63cec0fdf6809f4e1db9bb4f7d710c34582e3b35db62ac60eccafac7e" },
      joiner: { path: "joiner.int8.onnx", name: "joiner.onnx", size_bytes: 1_033_416, sha256: "b34584dc6f561089e1d747fedebb3765f2caa72c927ef54d7ca55e5ae40a814b" },
      tokens: ZH_2025_TOKENS,
    },
    notes: "2025 年多数据集训练的中文大模型，纯中文课堂推荐；只识别中文。",
  }),
  def({
    id: "zipformer-zh-fp16-2025",
    name: "中文 · 流式 zipformer 大模型（fp16，2025）",
    langs: ["zh"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-zh-fp16-2025-06-30",
    layout: "transducer",
    precision: "fp16",
    released: "2025-06-30",
    files: {
      encoder: { path: "encoder.fp16.onnx", name: "encoder.onnx", size_bytes: 309_439_670, sha256: "7391045897bee71f564afcf97c6e59f8cc1aba9b6f753c595f0bb4e69a52163f" },
      decoder: { path: "decoder.fp16.onnx", name: "decoder.onnx", size_bytes: 2_584_448, sha256: "e0f879ae5a563e0abbff73f8a11272c9055ca13d140d455a6541af0da23403e7" },
      joiner: { path: "joiner.fp16.onnx", name: "joiner.onnx", size_bytes: 2_052_890, sha256: "f321e25ff996a3f47047b010609e735fe429a26e9ffde53dcaff1ef31a2b7357" },
      tokens: ZH_2025_TOKENS,
    },
    notes: "同一 2025 中文大模型的半精度权重，比 int8 更准。",
  }),
  def({
    id: "zipformer-zh-xlarge-int8-2025",
    name: "中文 · 流式 zipformer 超大模型（int8，2025）",
    langs: ["zh"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-zh-xlarge-int8-2025-06-30",
    layout: "transducer",
    precision: "int8",
    released: "2025-06-30",
    files: {
      encoder: { path: "encoder.int8.onnx", name: "encoder.onnx", size_bytes: 761_133_737, sha256: "f2c543a0330e1ed0bd09c82e4ae7d3f1cbee10a15feca638fcc4f88083a36b8a" },
      decoder: { path: "decoder.onnx", name: "decoder.onnx", size_bytes: 8_533_022, sha256: "8f9c903da2818f207304a3f30b9eeb30028e30398f333c1e95e12c97704173e6" },
      joiner: { path: "joiner.int8.onnx", name: "joiner.onnx", size_bytes: 1_545_417, sha256: "f76ffce14b6ef80098cfdbce8846896ff68133970abc314eafab632f910df0d7" },
      tokens: ZH_XL_2025_TOKENS,
    },
    notes: "XL 规模的中文流式模型，目前 sherpa-onnx 里最准的中文流式选择。",
  }),
  def({
    id: "zipformer-zh-xlarge-fp16-2025",
    name: "中文 · 流式 zipformer 超大模型（fp16，2025）",
    langs: ["zh"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-zh-xlarge-fp16-2025-06-30",
    layout: "transducer",
    precision: "fp16",
    released: "2025-06-30",
    files: {
      encoder: { path: "encoder.fp16.onnx", name: "encoder.onnx", size_bytes: 1_494_711_848, sha256: "5847ec1814a3391f87134b5845aba669274a0818e0a4e2dec455935ee83131e3" },
      decoder: { path: "decoder.fp16.onnx", name: "decoder.onnx", size_bytes: 4_268_419, sha256: "7380dc85b8bb2ef8a5acbd2e58c9e8905644304fadde2ac0666e41c37764fae7" },
      joiner: { path: "joiner.fp16.onnx", name: "joiner.onnx", size_bytes: 3_076_894, sha256: "876455618c8c90dbe41cc960f983a36c178a944bede116cd1b20e0c845f429f0" },
      tokens: ZH_XL_2025_TOKENS,
    },
    notes: "XL 模型的半精度权重（1.5 GB），精度最高；实时转写需要较强的 CPU。",
  }),
  // ----- English -----
  def({
    id: "zipformer-en-int8",
    measuredMiB: 141,
    name: "English · 流式 zipformer（int8）",
    langs: ["en"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26",
    layout: "transducer",
    precision: "int8",
    released: "2023-06-26",
    files: {
      encoder: { path: "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx", name: "encoder.onnx", size_bytes: 71_083_163, sha256: "563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1" },
      decoder: { path: "decoder-epoch-99-avg-1-chunk-16-left-128.onnx", name: "decoder.onnx", size_bytes: 2_092_621, sha256: "7bf787f90b194b307e5a4ad6a34fadb4e748304c35f78a8d66358a05b13ee6ef" },
      joiner: { path: "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx", name: "joiner.onnx", size_bytes: 259_335, sha256: "d944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297" },
      tokens: EN_TOKENS,
    },
    notes: "英文课堂的默认模型（LibriSpeech），最省资源。",
  }),
  def({
    id: "zipformer-en-giga-int8",
    name: "English · 流式 zipformer 大模型（int8）",
    langs: ["en"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21",
    layout: "transducer",
    precision: "int8",
    released: "2023-06-21",
    files: {
      encoder: { path: "encoder-epoch-99-avg-1.int8.onnx", name: "encoder.onnx", size_bytes: 187_823_992, sha256: "32c98281c7bd8b63e3e142d007251b37f120572e8fdea9a4f5a79ce22b10ec4f" },
      decoder: { path: "decoder-epoch-99-avg-1.onnx", name: "decoder.onnx", size_bytes: 2_092_566, sha256: "9da02b77cb08826756ec6a88635f35a40374e4164e7c6359121a9145958a6ceb" },
      joiner: { path: "joiner-epoch-99-avg-1.int8.onnx", name: "joiner.onnx", size_bytes: 259_335, sha256: "831477d390e59a61f1b6a6f763b9903e6c6366ff6034f1ddba613be82637122f" },
      tokens: EN_TOKENS,
    },
    notes: "LibriSpeech + GigaSpeech 训练，对口语、讲座类英文更稳。",
  }),
  def({
    id: "zipformer-en-giga-fp32",
    name: "English · 流式 zipformer 大模型（fp32）",
    langs: ["en"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21",
    layout: "transducer",
    precision: "fp32",
    released: "2023-06-21",
    files: {
      encoder: { path: "encoder-epoch-99-avg-1.onnx", name: "encoder.onnx", size_bytes: 353_707_185, sha256: "b584884daad8cd4e60a5258e6da11876460089f1c4d3b5a92e19f0f104edb77a" },
      decoder: { path: "decoder-epoch-99-avg-1.onnx", name: "decoder.onnx", size_bytes: 2_092_566, sha256: "9da02b77cb08826756ec6a88635f35a40374e4164e7c6359121a9145958a6ceb" },
      joiner: { path: "joiner-epoch-99-avg-1.onnx", name: "joiner.onnx", size_bytes: 1_026_405, sha256: "bd5c26ad6a41cbd90c2cfa239c0b55b145af878ce1d79b4739d90f8be93359ba" },
      tokens: EN_TOKENS,
    },
    notes: "同一英文大模型的全精度权重。",
  }),
];

/** Built-in choice when the user has not picked a model (unchanged from v2). */
export const DEFAULT_MODEL_ID: Record<AsrLang, string> = {
  zh: "zipformer-bilingual-zh-en-int8",
  en: "zipformer-en-int8",
};

export const DEFAULT_MODEL_HOST = "https://huggingface.co";
export const MODEL_HOST_MIRROR = "https://hf-mirror.com";

export function modelFileUrl(host: string, def: AsrModelDef, file: AsrModelFile): string {
  return `${host.replace(/\/+$/, "")}/${def.repo}/resolve/main/${file.path}`;
}

/** The list handed to the Rust checks: name + expected size + digest. */
export function expectedFiles(def: AsrModelDef): { name: string; size_bytes: number; sha256: string }[] {
  return Object.values(def.files).map((f) => ({ name: f.name, size_bytes: f.size_bytes, sha256: f.sha256 }));
}

export function modelById(id: string): AsrModelDef | undefined {
  return ASR_MODELS.find((m) => m.id === id);
}

/** The tier a model falls in by download size. */
export function tierOf(def: AsrModelDef): AsrTier {
  return ASR_TIERS.find((t) => def.sizeBytes <= t.maxMiB * MIB) ?? ASR_TIERS[ASR_TIERS.length - 1];
}

/** "auto" follows the Chinese choice (the bilingual default understands both languages). */
export function langKey(lang: "auto" | "zh" | "en"): AsrLang {
  return lang === "en" ? "en" : "zh";
}

/** Models that can transcribe the language, selected one first, then the built-in default, then the rest. */
export function modelsForLang(lang: "auto" | "zh" | "en", selected?: Partial<Record<AsrLang, string>>): AsrModelDef[] {
  const key = langKey(lang);
  const wanted = [selected?.[key], DEFAULT_MODEL_ID[key]].filter((id): id is string => !!id);
  const list = ASR_MODELS.filter((m) => m.langs.includes(key));
  return [...wanted.map(modelById).filter((m): m is AsrModelDef => !!m && m.langs.includes(key)), ...list].filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
}

/** Which model the language setting maps to (docs/SPEC.md 7.6 / 16.2): the user's pick, else the built-in default. */
export function modelForLang(lang: "auto" | "zh" | "en", selected?: Partial<Record<AsrLang, string>>): AsrModelDef {
  return modelsForLang(lang, selected)[0];
}

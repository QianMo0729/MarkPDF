/**
 * Built-in model manifest (docs/SPEC.md 7.6). Files are fetched individually from
 * Hugging Face (or a mirror chosen in settings) so no archive extraction is needed.
 * Sizes and SHA-256 digests are the exact values published by the model repos
 * (Hugging Face LFS metadata, checked against downloaded copies on 2026-09-15);
 * a download is only "ready" when both match (release audit B05).
 */

export interface AsrModelFile {
  /** Path inside the model repo. */
  path: string;
  name: string;
  size_bytes: number;
  sha256: string;
}

export interface AsrModelDef {
  id: string;
  name: string;
  langs: ("zh" | "en")[];
  repo: string;
  files: { encoder: AsrModelFile; decoder: AsrModelFile; joiner: AsrModelFile; tokens: AsrModelFile };
  sizeBytes: number;
}

export const ASR_MODELS: AsrModelDef[] = [
  {
    id: "zipformer-bilingual-zh-en-int8",
    name: "中英双语（流式，int8）",
    langs: ["zh", "en"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20",
    files: {
      encoder: { path: "encoder-epoch-99-avg-1.int8.onnx", name: "encoder.onnx", size_bytes: 181_895_032, sha256: "8fa764187a261844f859d7143ebaa563af5d10adfece4c18a8f414c88cba2a9b" },
      decoder: { path: "decoder-epoch-99-avg-1.onnx", name: "decoder.onnx", size_bytes: 13_876_452, sha256: "2e3b5ec371f8899ee6acd829fd753ba45772df57a91bdf37cde3136354e7db7d" },
      joiner: { path: "joiner-epoch-99-avg-1.int8.onnx", name: "joiner.onnx", size_bytes: 3_228_404, sha256: "1ed689c5ed19dbaa725d9d191bb4822b5f4855a39e1ffd28cbc1f340d25b2ee0" },
      tokens: { path: "tokens.txt", name: "tokens.txt", size_bytes: 56_317, sha256: "a8e0e4ec53810e433789b54a5c0134a7eaa2ffca595a6334d54c00da858841d3" },
    },
    sizeBytes: 181_895_032 + 13_876_452 + 3_228_404 + 56_317,
  },
  {
    id: "zipformer-en-int8",
    name: "English（流式，int8）",
    langs: ["en"],
    repo: "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26",
    files: {
      encoder: { path: "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx", name: "encoder.onnx", size_bytes: 71_083_163, sha256: "563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1" },
      decoder: { path: "decoder-epoch-99-avg-1-chunk-16-left-128.onnx", name: "decoder.onnx", size_bytes: 2_092_621, sha256: "7bf787f90b194b307e5a4ad6a34fadb4e748304c35f78a8d66358a05b13ee6ef" },
      joiner: { path: "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx", name: "joiner.onnx", size_bytes: 259_335, sha256: "d944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297" },
      tokens: { path: "tokens.txt", name: "tokens.txt", size_bytes: 5_048, sha256: "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb" },
    },
    sizeBytes: 71_083_163 + 2_092_621 + 259_335 + 5_048,
  },
];

export const DEFAULT_MODEL_HOST = "https://huggingface.co";
export const MODEL_HOST_MIRROR = "https://hf-mirror.com";

export function modelFileUrl(host: string, def: AsrModelDef, file: AsrModelFile): string {
  return `${host.replace(/\/+$/, "")}/${def.repo}/resolve/main/${file.path}`;
}

/** The list handed to the Rust checks: name + expected size + digest. */
export function expectedFiles(def: AsrModelDef): { name: string; size_bytes: number; sha256: string }[] {
  return Object.values(def.files).map((f) => ({ name: f.name, size_bytes: f.size_bytes, sha256: f.sha256 }));
}

/** Which model the language setting maps to (docs/SPEC.md 7.6). */
export function modelForLang(lang: "auto" | "zh" | "en"): AsrModelDef {
  return lang === "en" ? ASR_MODELS[1] : ASR_MODELS[0];
}

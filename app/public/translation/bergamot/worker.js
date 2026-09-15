/* MarkPDF's local-only bridge to Mozilla Bergamot v0.6.0.
 * Model buffers arrive from the application's verified local cache. No text or
 * model is fetched by this worker; only the bundled engine is loaded here. */
importScripts("./bergamot-translator.js");

let runtime;
let service;
let model;
let modelId;
let allocated = [];

async function initialize() {
  if (runtime) return;
  const response = await fetch(new URL("./bergamot-translator.wasm", self.location));
  if (!response.ok) throw new Error(`离线引擎加载失败 (${response.status})`);
  const wasmBinary = await response.arrayBuffer();
  runtime = await new Promise((resolve, reject) => {
    const module = loadBergamot({
      INITIAL_MEMORY: 41_943_040,
      wasmBinary,
      print() {},
      printErr() {},
      onAbort(reason) { reject(new Error(`离线翻译引擎初始化失败：${reason}`)); },
      async onRuntimeInitialized() {
        await Promise.resolve();
        resolve(module);
      },
    });
  });
  service = new runtime.BlockingService({cacheSize: 0});
}

function freeModel() {
  model?.delete();
  model = undefined;
  modelId = undefined;
  for (const memory of allocated.reverse()) memory.delete();
  allocated = [];
}

function loadModel(payload) {
  if (modelId === payload.id) return;
  freeModel();
  const memories = {};
  try {
    for (const [type, buffer] of Object.entries(payload.files)) {
      const memory = new runtime.AlignedMemory(buffer.byteLength, type === "model" ? 256 : 64);
      memory.getByteArrayView().set(new Uint8Array(buffer));
      allocated.push(memory);
      memories[type] = memory;
    }
    const vocabList = new runtime.AlignedMemoryList();
    allocated.push(vocabList);
    if (memories.vocab) vocabList.push_back(memories.vocab);
    else {
      vocabList.push_back(memories.srcvocab);
      vocabList.push_back(memories.trgvocab);
    }
    const config = Object.entries({
      "beam-size": 1, normalize: 1, "word-penalty": 0,
      "max-length-break": 128, "mini-batch-words": 1024, workspace: 128,
      "max-length-factor": 2, "skip-cost": true, "cpu-threads": 0,
      quiet: true, "quiet-translation": true, "gemm-precision": "int8shiftAlphaAll", alignment: "soft",
    }).map(([key, value]) => `${key}: ${value}`).join("\n");
    model = new runtime.TranslationModel(payload.from, payload.to, config,
      memories.model, memories.lex ?? null, vocabList, null);
    modelId = payload.id;
  } catch (error) {
    freeModel();
    throw error;
  }
}

function translate(text) {
  if (!model) throw new Error("请先加载本地翻译模型");
  const inputs = new runtime.VectorString();
  const options = new runtime.VectorResponseOptions();
  let responses;
  let response;
  try {
    inputs.push_back(text);
    options.push_back({alignment: false, html: false, qualityScores: false});
    responses = service.translate(model, inputs, options);
    response = responses.get(0);
    return response.getTranslatedText();
  } finally {
    response?.delete();
    responses?.delete();
    options.delete();
    inputs.delete();
  }
}

// Serialize initialization/model mutation. Inference is synchronous inside this
// dedicated worker and can be cancelled by terminating it from the main thread.
let queue = Promise.resolve();
self.addEventListener("message", ({data}) => {
  queue = queue.then(async () => {
    try {
      let result;
      if (data.method === "initialize") await initialize();
      else if (data.method === "loadModel") loadModel(data.payload);
      else if (data.method === "translate") result = translate(data.payload);
      else throw new Error("未知离线翻译操作");
      self.postMessage({id: data.id, result});
    } catch (error) {
      self.postMessage({id: data.id, error: error instanceof Error ? error.message : String(error)});
    }
  });
});

/** Recreate pinned official assets; --models also downloads integration fixtures.
 * Run with Node 22+: node scripts/download-translation-assets.mjs --models
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(app, "public/translation/bergamot");
const provenance = JSON.parse(await readFile(join(engineDir, "provenance.json"), "utf8"));
const models = JSON.parse(await readFile(join(app, "src/data/translation/models.json"), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fetchVerified(url, destination, sha256, size, githubBlob = false) {
  try {
    const existing = await readFile(destination);
    if (hash(existing) === sha256 && (!size || existing.length === size)) {
      console.log("Cached:", destination);
      return;
    }
  } catch { /* File has not been downloaded yet. */ }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(240_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      const bytes = githubBlob
        ? Buffer.from((await response.json()).content, "base64")
        : Buffer.from(await response.arrayBuffer());
      if (hash(bytes) !== sha256 || (size && size !== bytes.length)) throw new Error("Official asset checksum mismatch");
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      console.log("Verified:", destination, bytes.length);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      console.warn("Retrying:", error.message);
    }
  }
}

await fetchVerified(provenance.wasm.url, join(engineDir, "bergamot-translator.wasm"), provenance.wasm.sha256, provenance.wasm.size);
await fetchVerified(`https://api.github.com/repos/mozilla-firefox/firefox/git/blobs/${provenance.glue.gitBlob}`,
  join(engineDir, "bergamot-translator.js"), provenance.glue.sha256, undefined, true);
if (process.argv.includes("--models")) {
  for (const model of models) {
    for (const file of model.files) await fetchVerified(file.url,
      join(app, "../.cache/translation-research/models", model.id, file.name), file.sha256, file.size);
  }
}

import { readFile, appendFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (path) => JSON.parse(await readFile(join(app, path), "utf8"));
const packageJson = await json("package.json");
const packageLock = await json("package-lock.json");
const tauri = await json("src-tauri/tauri.conf.json");
const cargo = await readFile(join(app, "src-tauri/Cargo.toml"), "utf8");
const cargoLock = await readFile(join(app, "src-tauri/Cargo.lock"), "utf8");
const cargoVersion = cargo.match(/\[package\][\s\S]*?\bversion\s*=\s*"([^"]+)"/)?.[1];
const cargoLockVersion = cargoLock.match(/\[\[package\]\]\s*name\s*=\s*"markpdf"\s*version\s*=\s*"([^"]+)"/)?.[1];
const version = packageJson.version;
const versions = [packageLock.version, packageLock.packages?.[""]?.version, tauri.version, cargoVersion, cargoLockVersion];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || versions.some((value) => value !== version)) {
  throw new Error(`Version mismatch: package=${version}, package-lock/Tauri/Cargo/Cargo.lock=${versions.join(", ")}`);
}
const tagIndex = process.argv.indexOf("--tag");
if (tagIndex >= 0 && process.argv[tagIndex + 1] !== `v${version}`) throw new Error(`Release tag must be v${version}`);
if (process.argv.includes("--github-output")) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  const body = await readFile(join(app, `../docs/RELEASE_NOTES_${version}.md`), "utf8");
  const delimiter = `markpdf_${randomUUID().replaceAll("-", "")}`;
  await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\nbody<<${delimiter}\n${body}\n${delimiter}\n`);
}
console.log(`MarkPDF ${version}: npm, Tauri, Cargo and both lockfiles agree.`);

# Third-party notices

MarkPDF 0.1.1 — inventory prepared on 2026-09-15.

MarkPDF uses the projects listed below. Their copyright notices and license terms
continue to apply to those components. This document does not assign a license to
MarkPDF's original code or grant rights in third-party trademarks.

The `licenses/` directory accompanies this document in the Windows installation
and inside the macOS app bundle (`MarkPDF.app/Contents/Resources`).
It contains full license texts, upstream notices, a versioned dependency inventory,
and the source URLs and hashes of separately retrieved license files.

## Offline translation

| Component | Version / source | License and notice |
| --- | --- | --- |
| Mozilla Bergamot inference engine and Firefox JavaScript binding | v0.6.0, revision `eea6e5a80aa4ddd86d9cc35ce9a65b79aa3ab96d` | MPL-2.0; [full text](licenses/bergamot-LICENSE) |
| Marian fork and vendored inference support code | Included at the same Mozilla revision | Original per-component notices in `licenses/bergamot-inference_*` |
| intgemm | `f7401513da71758dacce52fed1c7855549abee59` | MIT, with its upstream notices; [full text](licenses/bergamot-intgemm-LICENSE.txt) |
| SentencePiece used by Bergamot | `ae41b7740d7006596bb9257e83340b2620db9d00` | Apache-2.0; [full text](licenses/bergamot-sentencepiece-LICENSE.txt) |
| ssplit-cpp | `a311f9865ade34db1e8e080e6cc146f55dafb067` | C++ code: Apache-2.0; upstream separately documents LGPL-2.1 prefix data; [notice](licenses/bergamot-ssplit-LICENSE.txt) |
| Mozilla English → Simplified Chinese model | 2.2 | MPL-2.0; downloaded separately when requested |
| Mozilla Simplified Chinese → English desktop model | 2.0 | MPL-2.0; downloaded separately when requested |

Mozilla's [model licensing statement](https://github.com/mozilla/translations/blob/main/README.md)
explicitly identifies the published translation model files as MPL-2.0. The model
weights are not included in the source repository or Windows installer. The
application fetches the original, unmodified files from Mozilla's CDN and checks
the pinned SHA-256 values in `app/src/data/translation/models.json`.

### Corresponding source and modifications

The bundled `bergamot-translator.js` and `bergamot-translator.wasm` are unmodified
upstream artifacts. Their exact hashes, the JavaScript git blob, and the Mozilla
download URL are recorded in
[`provenance.json`](https://github.com/QianMo0729/MarkPDF/blob/v0.1.1/app/public/translation/bergamot/provenance.json).
`worker.js` is MarkPDF's integration code.

The engine's corresponding source is available from
[Mozilla at revision eea6e5a8](https://github.com/mozilla/translations/tree/eea6e5a80aa4ddd86d9cc35ce9a65b79aa3ab96d/inference),
including the submodule revisions listed in that source tree. Firefox's
[build instructions](https://firefox-source-docs.mozilla.org/toolkit/components/translations/resources/03_bergamot.html)
describe the WASM build. The exact Firefox binding can also be obtained by its
[git blob](https://api.github.com/repos/mozilla-firefox/firefox/git/blobs/4cc89e7b56dfa6d33e9b85deea3fdb9c8c11cffa).

## PDF rendering, fonts, and frontend

| Component | Version / source | License text |
| --- | --- | --- |
| PDF.js and bundled worker | `pdfjs-dist` 6.3.289 | [Apache-2.0](licenses/pdfjs-Apache-2.0.txt) |
| Adobe CMap data supplied by PDF.js | Files supplied with the pinned PDF.js package | [Original CMap notice](licenses/pdfjs-cmaps-LICENSE.txt) |
| Foxit standard fonts supplied by PDF.js | Files supplied with the pinned PDF.js package | [Original Foxit notice](licenses/pdfjs-fonts-Foxit-LICENSE.txt) |
| Liberation standard fonts supplied by PDF.js | Files supplied with the pinned PDF.js package | [SIL Open Font License and copyright](licenses/pdfjs-fonts-Liberation-LICENSE.txt) |
| Source Sans 3 | Adobe variable font | [SIL Open Font License 1.1](licenses/source-sans-OFL.txt) |
| Source Code Pro | Adobe variable font | [SIL Open Font License 1.1](licenses/source-code-pro-OFL.txt) |
| Material Symbols | `@material-symbols/font-400` 0.47.2 | [Apache-2.0](licenses/material-symbols-Apache-2.0.txt) |
| React, CodeMirror, Tauri JavaScript APIs, Dockview, Markdown, math, and other npm dependencies | Exact versions in `app/package-lock.json` | [Collected npm notices](licenses/npm-production-LICENSES.txt) |

The npm collection covers 82 installed production/transitive package entries. It
also identifies optional Node-only dependencies that are not browser application
code; listing a package does not mean every file in that package is redistributed.

## Native application and speech recognition

| Component | Version / source | License text |
| --- | --- | --- |
| Tauri, CPAL, Rubato, SQLite integration, HTTP/TLS, and other Rust dependencies | Exact versions in `app/src-tauri/Cargo.lock` | [Collected Cargo notices](licenses/rust-cargo-LICENSES.txt) |
| sherpa-onnx | 1.13.8 | [Apache-2.0](licenses/sherpa-onnx-LICENSE.txt) |
| ONNX Runtime | 1.28.2, as selected by sherpa-onnx 1.13.8's Windows static build | [MIT](licenses/native-onnxruntime-LICENSE.txt) and [third-party notices](licenses/native-onnxruntime-ThirdPartyNotices.txt) |
| kaldi-decoder | 0.3.0 | [Apache-2.0](licenses/native-kaldi-decoder-LICENSE.txt) |
| kaldi-native-fbank | 1.22.3 | [Apache-2.0](licenses/native-kaldi-native-fbank-LICENSE.txt) |
| Kiss FFT | `febd4caeed32e33ad8b2e0bb5ea77542c40f18ec` | [Copyright notice](licenses/native-kissfft-LICENSE.txt) and [BSD-3-Clause](licenses/native-kissfft-BSD-3-Clause.txt) |
| kaldifst | 1.8.0 | [Apache-2.0 and copyright notice](licenses/native-kaldifst-LICENSE.txt) |
| OpenFST | 1.8.5-2026-04-10, as selected by kaldifst | [Apache-2.0 notice](licenses/native-openfst-LICENSE.txt); full Apache text is included above |
| simple-sentencepiece | 0.7 | [Apache-2.0](licenses/native-simple-sentencepiece-LICENSE.txt) |

The Cargo collection covers the 444 package entries in the Windows dependency
resolution, including build dependencies. It records each package's declared
license, exact version, source/archive link, and its available copyright and
license files. This is a dependency inventory, not a claim that all of those
packages' code is present in the executable.

The macOS build resolves 37 further packages (Apple framework bindings such as the
`objc2` family, `core-foundation`, `coreaudio-rs`, and their build dependencies).
They are collected in the same form in
[`rust-cargo-LICENSES-macos.txt`](licenses/rust-cargo-LICENSES-macos.txt); every
other package of the macOS build appears in the Windows collection at the same
version. The `objc2` crates publish no license file in their registry archives, so
the repository's `LICENSE.md` at the published commit is retained there instead.

MPL-2.0 Rust dependencies are unmodified. Their corresponding source archives are
available through the exact version links in
[`dependency-inventory.json`](licenses/dependency-inventory.json): `cssparser`
0.36.0, `cssparser-macros` 0.6.1, `dtoa-short` 0.3.5, `option-ext` 0.2.0, and
`selectors` 0.36.1. The registry copy of `realfft` 3.5.0 declares MIT without a
standalone license/copyright file; the collection reproduces the standard MIT
permission and disclaimer without inventing a copyright statement.

The Windows release uses the official
`sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts-lib.tar.bz2`
speech-recognition build. Its SHA-256 is
`f0aa074ddc39553b30208b53e84c12275d09702911c9faa8d34fa932428e4641`.
[Upstream download](https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts-lib.tar.bz2),
[official build matrix](https://k2-fsa.github.io/sherpa/onnx/install/windows/generated/download/windows_x64.html).

The macOS release uses the matching official ASR-only builds,
`sherpa-onnx-v1.13.8-osx-arm64-static-no-tts-lib.tar.bz2` (SHA-256
`3d7f9b8a496694af13d9802c33b8133231e397bdef302f543d19468765e83136`) and, for Intel,
`sherpa-onnx-v1.13.8-osx-x64-static-no-tts-lib.tar.bz2` (SHA-256
`8ffc3ede9f997fec547b5c99b8e2073b8e04fd48a5f65e1a6d5d314ad0106ad9`), from the same
[upstream release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8).

MarkPDF vendors `sherpa-onnx-sys` 1.13.8 with a small build-script change selecting
these archives, checking their digests, and excluding the TTS libraries `espeak-ng`,
`piper_phonemize`, and `ucd` from the Windows x64 and macOS static links. The guard rejects a
supplied SDK containing those libraries. The upstream binding code and Apache-2.0
license are preserved; the exact change is described in
[`MARKPDF-PATCH.md`](https://github.com/QianMo0729/MarkPDF/blob/v0.1.1/app/src-tauri/vendor/sherpa-onnx-sys/MARKPDF-PATCH.md).
The earlier development build using the full TTS SDK is not the release build.

Speech-recognition model files are separate downloads from their respective model
repositories. They are not embedded in the installer. Their repository/model-card
terms apply to the downloaded files. Microsoft WebView2 is a separately installed
runtime; its own installer supplies the applicable Microsoft terms. On macOS the
interface runs in the system's WebKit and is set in the system fonts.

## License file provenance

[`upstream-sources.json`](licenses/upstream-sources.json) gives the official source
URL, git blob, and SHA-256 for license files fetched during this release audit.
Other collected license texts come from the exact installed npm and Cargo package
versions listed in the lockfiles. Files retain their upstream text. The main
Mozilla repository license does not replace individual third-party licenses.

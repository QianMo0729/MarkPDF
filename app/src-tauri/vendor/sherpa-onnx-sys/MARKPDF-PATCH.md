# MarkPDF Windows ASR-only native link patch

Upstream: `sherpa-onnx-sys` **1.13.8**, distributed on crates.io under Apache-2.0.
The original Rust FFI bindings and license are retained. `Cargo.toml.orig` records
the original manifest; the application selects this copy with `[patch.crates-io]`.

For **Windows x64 static** builds only, `build.rs`:

1. Downloads the official `sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts-lib.tar.bz2`.
2. Verifies its published SHA-256 before extracting a newly downloaded archive.
3. Omits `piper_phonemize`, `espeak-ng` and `ucd` from native link directives.
4. Rejects a library-directory override containing those full-SDK libraries.

The additional `sha2` build dependency checks the archive. Public FFI types and
the ASR API are unchanged. MarkPDF does not call TTS APIs. Other upstream target
selection remains unchanged and is not covered by MarkPDF's Windows release QA.

- [Official Windows download matrix](https://k2-fsa.github.io/sherpa/onnx/install/windows/generated/download/windows_x64.html)
- [Official release archive](https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-static-MT-Release-no-tts-lib.tar.bz2)
- SHA-256: `f0aa074ddc39553b30208b53e84c12275d09702911c9faa8d34fa932428e4641`
- Size: 120,099,517 bytes.

Do not restore the full SDK for Windows releases: a real MSVC release link map
showed eSpeak/Piper exported functions retained in that executable despite ASR-only
application usage. A new SDK version requires a fresh digest and native link audit.
